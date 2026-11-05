package sandbox

import (
	"context"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"
)

/*
 * Limits. A node is shared by the household and by the Portal and everything
 * else the server runs, so no one's sandboxes may take all of it.
 *
 *   each sandbox     CPUs, memory with no swap on top, and a process count
 *   awake sandboxes  running or paused, per person and per node. Waking one past
 *                    a cap stops the person's (or, for the node cap, anyone's)
 *                    least recently used sandbox that isn't working; when every
 *                    one is working, waking is refused, naming the tasks that
 *                    hold the slots.
 *   disk             Docker can't cap a volume here: the local volume driver has
 *                    no size, and overlay2 quotas need XFS mounted with pquota.
 *                    So the node measures each awake sandbox's files (the
 *                    repository, the agent's home and /tmp). Past the quota
 *                    every turn starts by telling the agent to free space; past
 *                    the quota and a margin, a turn is stopped and the published
 *                    app is stopped, so nothing keeps writing.
 *
 * The node's flags set the defaults; the Portal sends its own (Code's settings)
 * with every ensure, and the node uses the latest it was sent.
 */

// Limits are what each sandbox and each person may use.
type Limits struct {
	CPUs           float64 `json:"cpus"`
	MemoryMB       int     `json:"memoryMb"`
	AwakePerPerson int     `json:"awakePerPerson"`
	AwakePerNode   int     `json:"awakePerNode"`
	DiskGB         int     `json:"diskGb"`
}

// merge takes the fields of other that are set and sensible.
func (l Limits) merge(other *Limits) Limits {
	if other == nil {
		return l
	}
	if other.CPUs >= 0.25 && other.CPUs <= 64 {
		l.CPUs = other.CPUs
	}
	if other.MemoryMB >= 256 && other.MemoryMB <= 256<<10 {
		l.MemoryMB = other.MemoryMB
	}
	if other.AwakePerPerson >= 1 && other.AwakePerPerson <= 100 {
		l.AwakePerPerson = other.AwakePerPerson
	}
	if other.AwakePerNode >= 1 && other.AwakePerNode <= 200 {
		l.AwakePerNode = other.AwakePerNode
	}
	if other.DiskGB >= 1 && other.DiskGB <= 4096 {
		l.DiskGB = other.DiskGB
	}
	return l
}

func (l Limits) diskQuota() int64 { return int64(l.DiskGB) << 30 }

// diskCeiling is where writing stops: the quota and a tenth more, at least 1 GB.
func (l Limits) diskCeiling() int64 {
	margin := l.diskQuota() / 10
	if margin < 1<<30 {
		margin = 1 << 30
	}
	return l.diskQuota() + margin
}

func (l Limits) dockerArgs() []string {
	memory := strconv.Itoa(l.MemoryMB) + "m"
	// Swap equal to memory means none: the cap can't be dodged by swapping.
	return []string{"--cpus", strconv.FormatFloat(l.CPUs, 'f', -1, 64), "--memory", memory, "--memory-swap", memory}
}

// parseMemory reads Docker's notation (512m, 2g, 1.5g) as megabytes.
func parseMemory(value string) (int, bool) {
	value = strings.ToLower(strings.TrimSpace(value))
	unit := 1.0 / (1 << 20)
	switch {
	case strings.HasSuffix(value, "g"):
		unit, value = 1024, strings.TrimSuffix(value, "g")
	case strings.HasSuffix(value, "m"):
		unit, value = 1, strings.TrimSuffix(value, "m")
	case strings.HasSuffix(value, "k"):
		unit, value = 1.0/1024, strings.TrimSuffix(value, "k")
	case strings.HasSuffix(value, "b"):
		value = strings.TrimSuffix(value, "b")
	}
	n, err := strconv.ParseFloat(value, 64)
	if err != nil || n <= 0 {
		return 0, false
	}
	return int(n * unit), true
}

func (s *Server) limitsNow() Limits {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.limits
}

// limitsPrompt tells the agent what it has to work with.
func limitsPrompt(l Limits) string {
	cpus := strconv.FormatFloat(l.CPUs, 'f', -1, 64)
	plural := "s"
	if l.CPUs == 1 {
		plural = ""
	}
	return fmt.Sprintf("This sandbox has %s CPU%s, %s of memory with no swap, and %d GB of disk, shared by your tools and the app you publish. Build apps that fit: one server process, a production build or a light dev server, no heavy background jobs, and small data. Something that needs more memory is stopped.",
		cpus, plural, gigabytes(int64(l.MemoryMB)<<20), l.DiskGB)
}

func gigabytes(bytes int64) string {
	value := float64(bytes) / (1 << 30)
	if value == float64(int64(value)) {
		return fmt.Sprintf("%.0f GB", value)
	}
	return fmt.Sprintf("%.1f GB", value)
}

/* ── awake caps ── */

// awakeBox is one sandbox that is running or paused.
type awakeBox struct {
	id, owner, title string
	quiet            time.Duration
	busy             bool
}

// roomRefusal is waking refused: every sandbox holding a slot is working.
type roomRefusal struct {
	perPerson bool
	limit     int
	holders   []awakeBox
}

func (r *roomRefusal) message() string {
	var names []string
	for _, h := range r.holders {
		name := h.title
		if name == "" {
			name = "a task"
		} else {
			name = "“" + name + "”"
		}
		if !r.perPerson && h.owner != "" {
			name += " (" + h.owner + ")"
		}
		names = append(names, name)
	}
	list := strings.Join(names, ", ")
	if r.perPerson {
		return fmt.Sprintf("You can have %d %s awake at once, and yours are all working: %s. Try again when one finishes, or stop one.", r.limit, plural(r.limit, "task", "tasks"), list)
	}
	return fmt.Sprintf("This server runs %d %s at once, and all of them are working: %s. Try again when one finishes.", r.limit, plural(r.limit, "task", "tasks"), list)
}

func plural(n int, one, many string) string {
	if n == 1 {
		return one
	}
	return many
}

// planRoom picks the sandboxes to put to sleep so one more owned by owner can
// wake, the least recently used first, never one that is working. awake are
// the others that are running or paused.
func planRoom(awake []awakeBox, owner string, perPerson, perNode int) ([]awakeBox, *roomRefusal) {
	sorted := append([]awakeBox(nil), awake...)
	sort.SliceStable(sorted, func(i, j int) bool { return sorted[i].quiet > sorted[j].quiet })
	chosen := map[string]bool{}
	var evict []awakeBox
	// take puts to sleep enough of the candidates to leave fewer than limit awake.
	take := func(candidates []awakeBox, limit int) bool {
		awakeNow := 0
		for _, c := range candidates {
			if !chosen[c.id] {
				awakeNow++
			}
		}
		for _, c := range candidates {
			if awakeNow < limit {
				break
			}
			if !c.busy && !chosen[c.id] {
				chosen[c.id] = true
				evict = append(evict, c)
				awakeNow--
			}
		}
		return awakeNow < limit
	}
	held := func(candidates []awakeBox) []awakeBox {
		var still []awakeBox
		for _, c := range candidates {
			if !chosen[c.id] {
				still = append(still, c)
			}
		}
		return still
	}
	if owner != "" && perPerson > 0 {
		var mine []awakeBox
		for _, box := range sorted {
			if box.owner == owner {
				mine = append(mine, box)
			}
		}
		if !take(mine, perPerson) {
			return nil, &roomRefusal{perPerson: true, limit: perPerson, holders: held(mine)}
		}
	}
	if perNode > 0 && !take(sorted, perNode) {
		return nil, &roomRefusal{limit: perNode, holders: held(sorted)}
	}
	return evict, nil
}

// makeRoom puts sandboxes to sleep so id can wake within the caps, and returns
// the ones it stopped. The caller holds s.room.
func (s *Server) makeRoom(ctx context.Context, id string) ([]string, error) {
	found, err := s.docker.sandboxes(ctx)
	if err != nil {
		return nil, err
	}
	limits := s.limitsNow()
	now := s.now()
	var awake []awakeBox
	for other, state := range found {
		if other == id || state != "running" && state != "paused" {
			continue
		}
		quiet, busy := s.quietFor(other, now)
		owner, title := s.ownerOf(other)
		awake = append(awake, awakeBox{id: other, owner: owner, title: title, quiet: quiet, busy: busy})
	}
	owner, _ := s.ownerOf(id)
	evict, refused := planRoom(awake, owner, limits.AwakePerPerson, limits.AwakePerNode)
	if refused != nil {
		return nil, problem(429, refused.message())
	}
	var slept []string
	for _, box := range evict {
		lock := s.wakeLock(box.id)
		if !lock.TryLock() {
			// Being woken or put to sleep right now: try again in a moment.
			return slept, problem(429, "Kimono is making room for this task. Try again in a moment.")
		}
		state, _ := s.docker.containerState(ctx, box.id)
		if state == "paused" {
			_, _ = s.docker.run(ctx, nil, "unpause", containerName(box.id))
		}
		_, err := s.docker.run(ctx, nil, "stop", "-t", "5", containerName(box.id))
		lock.Unlock()
		if err != nil {
			return slept, err
		}
		s.cfg.Logf("stop %s to make room for %s", box.id, id)
		slept = append(slept, box.id)
	}
	return slept, nil
}

// ownerOf is who a sandbox belongs to and its task's title, as the Portal said.
func (s *Server) ownerOf(id string) (string, string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if r := s.records[id]; r != nil {
		return r.Owner, r.Title
	}
	return "", ""
}

/* ── disk ── */

// diskScript adds up what a sandbox keeps, in kilobytes: the repository, the
// agent's home (caches, installed tools) and /tmp.
const diskScript = `du -skx /workspace /home/agent /tmp 2>/dev/null | awk '{ n += $1 } END { print n + 0 }'`

// measureDisk counts a running sandbox's files and keeps the answer.
func (s *Server) measureDisk(ctx context.Context, id string) (int64, error) {
	out, err := s.docker.run(ctx, nil, "exec", "-u", "agent", containerName(id), "sh", "-c", diskScript)
	if err != nil && len(out) == 0 {
		return 0, err
	}
	kilobytes, err := strconv.ParseInt(strings.TrimSpace(string(out)), 10, 64)
	if err != nil {
		return 0, err
	}
	used := kilobytes << 10
	s.mu.Lock()
	if r := s.records[id]; r != nil {
		r.Disk, r.DiskAt = used, s.now()
	}
	s.mu.Unlock()
	return used, nil
}

// diskUse is the last measurement, and when it was taken.
func (s *Server) diskUse(id string) (int64, time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if r := s.records[id]; r != nil {
		return r.Disk, r.DiskAt
	}
	return 0, time.Time{}
}

func (s *Server) diskJSON(id string) any {
	used, at := s.diskUse(id)
	quota := s.limitsNow().diskQuota()
	if at.IsZero() {
		return map[string]any{"quota": quota}
	}
	return map[string]any{"used": used, "quota": quota, "at": at.UnixMilli()}
}

// checkDisks measures the awake sandboxes whose numbers are older than five
// minutes, a few per sweep, and stops the published app of one past the ceiling.
func (s *Server) checkDisks(ctx context.Context, found map[string]string) {
	limits := s.limitsNow()
	measured := 0
	for id, state := range found {
		if state != "running" || measured >= 2 {
			continue
		}
		if _, at := s.diskUse(id); s.now().Sub(at) < 5*time.Minute {
			continue
		}
		measured++
		used, err := s.measureDisk(ctx, id)
		if err != nil || used <= limits.diskCeiling() {
			continue
		}
		if p := s.previewCopy(id); p != nil && !p.Stopped {
			s.setStopped(id, true)
			_, _ = s.docker.run(ctx, nil, "exec", "-u", "agent", containerName(id), "kimono-unserve", "--quiet")
			s.cfg.Logf("stop the app of %s: its files take %s, past %s", id, gigabytes(used), gigabytes(limits.diskQuota()))
		}
	}
}

// diskNote is what the agent is told at the start of a turn when the sandbox is full.
func diskNote(used int64, l Limits) string {
	if used <= l.diskQuota() {
		return ""
	}
	return fmt.Sprintf("The sandbox is full: its files take %s of the %d GB it may use. Before anything else, free space (dependency caches, build output, logs, data you made for testing). If it goes past %s, this turn is stopped and the app you published stops.", gigabytes(used), l.DiskGB, gigabytes(l.diskCeiling()))
}
