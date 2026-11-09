package server

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/kimonoapps/kimono/cli/internal/reconcile"
	"github.com/kimonoapps/kimono/cli/internal/system"
)

// Outline's database outlived the app: compose drops a removed service's
// containers but keeps its volumes. import-outline starts Postgres on that
// volume, with no network, reads what people wrote, and leaves it for the
// Portal, which turns it into notebooks when it next starts. The volume is
// left as it was.

const (
	outlineExportContainer = "kimono-outline-export"
	outlinePostgresImage   = "postgres:16-alpine"
	portalContainer        = "kimono-server-portal-1"
	// The Portal image runs as node, uid and gid 1000.
	portalUID = 1000
)

// What is read, table by table. A table this Outline never had is skipped.
var outlineQueries = []struct{ key, table, sql string }{
	{"users", "users", `SELECT json_agg(json_build_object('id', id, 'email', email, 'name', name, 'deletedAt', coalesce("deletedAt", "suspendedAt"))) FROM users`},
	{"collections", "collections", `SELECT json_agg(to_jsonb(c) - 'state' - 'searchVector') FROM collections c`},
	{"documents", "documents", `SELECT json_agg(to_jsonb(d) - 'state' - 'searchVector' - 'previousTitles') FROM documents d`},
	{"userPermissions", "user_permissions", `SELECT json_agg(to_jsonb(p)) FROM user_permissions p`},
	{"collectionUsers", "collection_users", `SELECT json_agg(to_jsonb(p)) FROM collection_users p`},
	{"groupPermissions", "group_permissions", `SELECT json_agg(to_jsonb(p)) FROM group_permissions p`},
	{"collectionGroups", "collection_groups", `SELECT json_agg(to_jsonb(p)) FROM collection_groups p`},
	{"groupUsers", "group_users", `SELECT json_agg(to_jsonb(p)) FROM group_users p`},
}

func (m *Manager) importOutline(args []string) error {
	if err := system.RequireRoot(); err != nil {
		return err
	}
	flags := flag.NewFlagSet("server import-outline", flag.ContinueOnError)
	volume := flags.String("volume", "", "the Docker volume holding Outline's Postgres data (found on its own when left out)")
	noRestart := flags.Bool("no-restart", false, "leave the export for the Portal's next start instead of restarting it now")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if *volume == "" {
		found, err := m.outlineVolume()
		if err != nil {
			return err
		}
		*volume = found
	}
	_, _ = fmt.Fprintf(m.Runner.Stdout, "Reading Outline's notes from volume %s.\n", *volume)

	_ = m.Runner.Run("docker", "rm", "-f", outlineExportContainer)
	if err := m.Runner.Run("docker", "run", "-d", "--name", outlineExportContainer, "--network", "none",
		"-v", *volume+":/var/lib/postgresql/data", outlinePostgresImage); err != nil {
		return fmt.Errorf("start Postgres on Outline's data: %w", err)
	}
	defer func() { _ = m.Runner.Run("docker", "rm", "-f", outlineExportContainer) }()
	if err := m.waitForOutlineDatabase(); err != nil {
		return err
	}

	dump := map[string]json.RawMessage{}
	for _, q := range outlineQueries {
		exists, err := m.outlinePSQL(fmt.Sprintf("SELECT to_regclass('public.%s') IS NOT NULL", q.table))
		if err != nil {
			return err
		}
		if strings.TrimSpace(exists) != "t" {
			continue
		}
		out, err := m.outlinePSQL(q.sql)
		if err != nil {
			return fmt.Errorf("read %s: %w", q.table, err)
		}
		out = strings.TrimSpace(out)
		if out == "" {
			out = "[]"
		}
		if !json.Valid([]byte(out)) {
			return fmt.Errorf("read %s: Postgres did not return JSON", q.table)
		}
		dump[q.key] = json.RawMessage(out)
	}
	var documents []json.RawMessage
	_ = json.Unmarshal(dump["documents"], &documents)
	_, _ = fmt.Fprintf(m.Runner.Stdout, "Found %d documents.\n", len(documents))

	encoded, err := json.Marshal(dump)
	if err != nil {
		return err
	}
	state := filepath.Dir(m.reconcilePaths().DeploymentDir)
	imports := filepath.Join(state, "imports")
	if err := os.MkdirAll(imports, 0o700); err != nil {
		return err
	}
	_ = os.Chown(imports, portalUID, portalUID)
	result := filepath.Join(imports, "outline.result.json")
	_ = os.Remove(result)
	target := filepath.Join(imports, "outline.json")
	if err := writeOwned(target, encoded); err != nil {
		return err
	}

	if *noRestart {
		_, _ = fmt.Fprintln(m.Runner.Stdout, "Notes will bring them in the next time the Portal starts.")
		return nil
	}
	_, _ = fmt.Fprintln(m.Runner.Stdout, "Restarting the Portal so Notes brings them in.")
	if err := m.Runner.Run("docker", "restart", portalContainer); err != nil {
		return err
	}
	return m.reportOutlineImport(result)
}

func writeOwned(path string, data []byte) error {
	temp := path + ".part"
	if err := os.WriteFile(temp, data, 0o600); err != nil {
		return err
	}
	_ = os.Chown(temp, portalUID, portalUID)
	return os.Rename(temp, path)
}

// outlineVolume finds the volume compose made for Outline's database.
func (m *Manager) outlineVolume() (string, error) {
	out, err := m.Runner.Output("docker", "volume", "ls", "-q",
		"--filter", "label=com.docker.compose.project="+reconcile.ProjectName,
		"--filter", "label=com.docker.compose.volume=outline-database")
	if err != nil {
		return "", err
	}
	names := strings.Fields(string(out))
	if len(names) == 0 {
		fallback := reconcile.ProjectName + "_outline-database"
		if _, err := m.Runner.Output("docker", "volume", "inspect", fallback); err == nil {
			return fallback, nil
		}
		return "", errors.New("Outline's database volume isn't here any more; restore it from a backup, then pass --volume")
	}
	if len(names) > 1 {
		return "", fmt.Errorf("more than one Outline database volume (%s); pass --volume", strings.Join(names, ", "))
	}
	return names[0], nil
}

func (m *Manager) outlinePSQL(sql string) (string, error) {
	out, err := m.Runner.Output("docker", "exec", outlineExportContainer, "psql", "-U", "outline", "-d", "outline", "-tAX", "-v", "ON_ERROR_STOP=1", "-c", sql)
	return string(out), err
}

func (m *Manager) waitForOutlineDatabase() error {
	for i := 0; i < 60; i++ {
		if out, err := m.Runner.OutputCombined("docker", "exec", outlineExportContainer, "psql", "-U", "outline", "-d", "outline", "-tAX", "-c", "SELECT to_regclass('public.documents') IS NOT NULL"); err == nil {
			if strings.TrimSpace(string(out)) == "t" {
				return nil
			}
			return errors.New("that volume's database has no Outline documents in it")
		}
		time.Sleep(time.Second)
	}
	logs, _ := m.Runner.OutputCombined("docker", "logs", "--tail", "20", outlineExportContainer)
	return fmt.Errorf("Postgres didn't start on Outline's data:\n%s", logs)
}

func (m *Manager) reportOutlineImport(result string) error {
	deadline := time.Now().Add(3 * time.Minute)
	for time.Now().Before(deadline) {
		raw, err := os.ReadFile(result)
		if err != nil {
			time.Sleep(2 * time.Second)
			continue
		}
		var summary struct {
			OK              bool   `json:"ok"`
			Error           string `json:"error"`
			Notebooks       int    `json:"notebooks"`
			Sections        int    `json:"sections"`
			Notes           int    `json:"notes"`
			Shares          int    `json:"shares"`
			AlreadyImported int    `json:"alreadyImported"`
			WithAttachments int    `json:"withAttachments"`
			Unmatched       []struct {
				Name      string `json:"name"`
				Email     string `json:"email"`
				Documents int    `json:"documents"`
			} `json:"unmatched"`
			Skipped []struct {
				Title  string `json:"title"`
				Reason string `json:"reason"`
			} `json:"skipped"`
		}
		if err := json.Unmarshal(raw, &summary); err != nil {
			return err
		}
		if !summary.OK {
			return fmt.Errorf("Notes couldn't bring them in: %s", summary.Error)
		}
		out := m.Runner.Stdout
		_, _ = fmt.Fprintf(out, "Brought in %d notes, %d notebooks, %d sections; shared %d times. %d were already here.\n",
			summary.Notes, summary.Notebooks, summary.Sections, summary.Shares, summary.AlreadyImported)
		if summary.WithAttachments > 0 {
			_, _ = fmt.Fprintf(out, "%d notes link to Outline attachments, which didn't come across.\n", summary.WithAttachments)
		}
		for _, u := range summary.Unmatched {
			_, _ = fmt.Fprintf(out, "No Kimono account for %s <%s>: %d documents left out. Give them an account with that email and run this again.\n", u.Name, u.Email, u.Documents)
		}
		for _, s := range summary.Skipped {
			_, _ = fmt.Fprintf(out, "Left out %q: %s.\n", s.Title, s.Reason)
		}
		return nil
	}
	return errors.New("the Portal hasn't said how the import went; see kimono server logs portal")
}
