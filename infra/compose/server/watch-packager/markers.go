package main

// What the Portal needs to find skip intro, skip recap and the credits in a
// file that has no AniSkip entry (apps/portal/src/lib/watch/skips.ts):
//
//   - /chapters: the file's chapters and its length (cheap: Matroska keeps
//     them in the head).
//   - /fingerprint: a Chromaprint fingerprint of the first audio track over
//     a stretch of the file, compared across a season's episodes by the
//     Portal to find the shared intro and credits.
//   - /ending: how dark each keyframe is and where the sound goes quiet near
//     the end, for credits on films and anything else.
//
// The last two read minutes of a stream, so they run one at a time, at the
// lowest CPU priority, behind whatever is playing.

import (
	"bufio"
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"
)

/* One analysis at a time: they read the stream at full speed. */
var analysis = make(chan struct{}, 1)

func lowPriority(ctx context.Context, bin string, args ...string) *exec.Cmd {
	if nice, err := exec.LookPath("nice"); err == nil {
		return exec.CommandContext(ctx, nice, append([]string{"-n", "19", bin}, args...)...)
	}
	return exec.CommandContext(ctx, bin, args...)
}

type analysisBody struct {
	Input  string  `json:"input"`
	Start  float64 `json:"start"`
	Length float64 `json:"length"`
}

func readAnalysis(w http.ResponseWriter, r *http.Request) (analysisBody, bool) {
	var body analysisBody
	if err := json.NewDecoder(io.LimitReader(r.Body, 64<<10)).Decode(&body); err != nil || !strings.HasPrefix(body.Input, "http") || body.Start < 0 || body.Length < 0 || body.Length > 1800 {
		http.Error(w, "bad input", http.StatusBadRequest)
		return body, false
	}
	return body, true
}

/*
Answers a long analysis: headers at once, then a space every 20 seconds
while it works (JSON allows leading whitespace) so the Portal's fetch
doesn't time out waiting, then {"error"} or the result.
*/
func respondLater(w http.ResponseWriter, r *http.Request, work func() (any, error)) {
	w.Header().Set("content-type", "application/json")
	w.WriteHeader(http.StatusOK)
	flusher, _ := w.(http.Flusher)
	if flusher != nil {
		flusher.Flush()
	}
	done := make(chan struct{})
	var result any
	var err error
	go func() { result, err = work(); close(done) }()
	beat := time.NewTicker(20 * time.Second)
	defer beat.Stop()
	for {
		select {
		case <-done:
			if err != nil {
				_ = json.NewEncoder(w).Encode(map[string]any{"error": err.Error()})
			} else {
				_ = json.NewEncoder(w).Encode(result)
			}
			return
		case <-beat.C:
			_, _ = w.Write([]byte(" "))
			if flusher != nil {
				flusher.Flush()
			}
		case <-r.Context().Done():
			<-done
			return
		}
	}
}

/* Waits its turn; false when the caller gave up first. */
func turn(ctx context.Context) bool {
	select {
	case analysis <- struct{}{}:
		return true
	case <-ctx.Done():
		return false
	}
}

/* ───── Chapters ───── */

type chapter struct {
	Start float64 `json:"start"`
	End   float64 `json:"end"`
	Title string  `json:"title"`
}

func handleChapters(w http.ResponseWriter, r *http.Request) {
	body, ok := readAnalysis(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, ffprobePath, "-v", "error", "-print_format", "json", "-show_chapters", "-show_entries", "format=duration,size:stream=codec_type",
		"-probesize", "5M", "-analyzeduration", "0", localInput(body.Input))
	errs := &tail{}
	cmd.Stderr = errs
	out, err := cmd.Output()
	if err != nil {
		http.Error(w, fmt.Sprintf("ffprobe couldn't read it: %v %s", err, lastLine(errs.String())), http.StatusBadGateway)
		return
	}
	var parsed struct {
		Chapters []struct {
			Start string            `json:"start_time"`
			End   string            `json:"end_time"`
			Tags  map[string]string `json:"tags"`
		} `json:"chapters"`
		Format struct {
			Duration string `json:"duration"`
			Size     string `json:"size"`
		} `json:"format"`
		Streams []struct {
			Type string `json:"codec_type"`
		} `json:"streams"`
	}
	if err := json.Unmarshal(out, &parsed); err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	chapters := []chapter{}
	for _, c := range parsed.Chapters {
		start, _ := strconv.ParseFloat(c.Start, 64)
		end, _ := strconv.ParseFloat(c.End, 64)
		chapters = append(chapters, chapter{Start: start, End: end, Title: c.Tags["title"]})
	}
	duration, _ := strconv.ParseFloat(parsed.Format.Duration, 64)
	size, _ := strconv.ParseInt(parsed.Format.Size, 10, 64)
	audio := false
	for _, s := range parsed.Streams {
		audio = audio || s.Type == "audio"
	}
	writeJSON(w, http.StatusOK, map[string]any{"duration": duration, "size": size, "audio": audio, "chapters": chapters})
}

/* ───── Fingerprints ───── */

func handleFingerprint(w http.ResponseWriter, r *http.Request) {
	body, ok := readAnalysis(w, r)
	if !ok {
		return
	}
	if body.Length <= 0 {
		http.Error(w, "bad length", http.StatusBadRequest)
		return
	}
	respondLater(w, r, func() (any, error) { return fingerprint(r.Context(), body) })
}

func fingerprint(parent context.Context, body analysisBody) (any, error) {
	if !turn(parent) {
		return nil, parent.Err()
	}
	defer func() { <-analysis }()
	started := time.Now()
	ctx, cancel := context.WithTimeout(parent, 20*time.Minute)
	defer cancel()
	cmd := lowPriority(ctx, ffmpegPath, "-nostdin", "-hide_banner", "-v", "error",
		"-ss", strconv.FormatFloat(body.Start, 'f', 3, 64), "-t", strconv.FormatFloat(body.Length, 'f', 3, 64),
		"-i", localInput(body.Input), "-map", "0:a:0", "-ac", "2", "-f", "chromaprint", "-fp_format", "raw", "-")
	errs := &tail{}
	cmd.Stderr = errs
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("ffmpeg couldn't fingerprint it: %v %s", err, lastLine(errs.String()))
	}
	points := make([]uint32, len(out)/4)
	for i := range points {
		points[i] = binary.LittleEndian.Uint32(out[i*4:])
	}
	log.Printf("fingerprint: %d points from %.0fs for %.0fs in %s", len(points), body.Start, body.Length, time.Since(started).Round(time.Second))
	return map[string]any{"start": body.Start, "points": points, "ms": time.Since(started).Milliseconds()}, nil
}

/* ───── The ending ───── */

var (
	darkLine    = regexp.MustCompile(`pblack:(\d+).*? t:([0-9.]+)`)
	silentStart = regexp.MustCompile(`silence_start: (-?[0-9.]+)`)
	silentEnd   = regexp.MustCompile(`silence_end: (-?[0-9.]+)`)
)

func handleEnding(w http.ResponseWriter, r *http.Request) {
	body, ok := readAnalysis(w, r)
	if !ok {
		return
	}
	respondLater(w, r, func() (any, error) { return ending(r.Context(), body) })
}

func ending(parent context.Context, body analysisBody) (any, error) {
	if !turn(parent) {
		return nil, parent.Err()
	}
	defer func() { <-analysis }()
	started := time.Now()
	ctx, cancel := context.WithTimeout(parent, 20*time.Minute)
	defer cancel()
	args := []string{"-nostdin", "-hide_banner", "-nostats", "-v", "info", "-skip_frame", "nokey",
		"-ss", strconv.FormatFloat(body.Start, 'f', 3, 64)}
	if body.Length > 0 {
		args = append(args, "-t", strconv.FormatFloat(body.Length, 'f', 3, 64))
	}
	args = append(args, "-i", localInput(body.Input),
		"-filter_complex", "[0:v:0]scale=320:-2,blackframe=amount=0:threshold=32[v];[0:a:0]silencedetect=n=-50dB:d=0.4[a]",
		"-map", "[v]", "-map", "[a]", "-f", "null", "-")
	cmd := lowPriority(ctx, ffmpegPath, args...)
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	frames := [][2]float64{}
	silences := [][2]float64{}
	last := ""
	open := -1.0
	lines := bufio.NewScanner(stderr)
	lines.Buffer(make([]byte, 64<<10), 1<<20)
	for lines.Scan() {
		line := lines.Text()
		last = line
		if m := darkLine.FindStringSubmatch(line); m != nil {
			dark, _ := strconv.ParseFloat(m[1], 64)
			t, _ := strconv.ParseFloat(m[2], 64)
			frames = append(frames, [2]float64{round1(body.Start + t), dark})
		} else if m := silentStart.FindStringSubmatch(line); m != nil {
			open, _ = strconv.ParseFloat(m[1], 64)
		} else if m := silentEnd.FindStringSubmatch(line); m != nil && open >= 0 {
			end, _ := strconv.ParseFloat(m[1], 64)
			silences = append(silences, [2]float64{round1(body.Start + open), round1(body.Start + end)})
			open = -1
		}
	}
	if err := cmd.Wait(); err != nil {
		return nil, fmt.Errorf("ffmpeg couldn't read the ending: %v %s", err, last)
	}
	if open >= 0 {
		silences = append(silences, [2]float64{round1(body.Start + open), -1})
	}
	log.Printf("ending: %d frames, %d quiet stretches from %.0fs in %s", len(frames), len(silences), body.Start, time.Since(started).Round(time.Second))
	return map[string]any{"frames": frames, "silences": silences, "ms": time.Since(started).Milliseconds()}, nil
}

func round1(v float64) float64 { return float64(int64(v*10+0.5)) / 10 }
