package backup

import (
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"syscall"
)

type RecoveryKit struct {
	Format         string `json:"format"`
	Repository     string `json:"repository"`
	Password       string `json:"password"`
	KeyID          string `json:"keyId"`
	ApplicationKey string `json:"applicationKey"`
}

// KitConfig reads a recovery kit into backup settings with scheduling paused.
func KitConfig(file string) (Config, error) {
	var kit RecoveryKit
	if err := readJSON(file, &kit); err != nil {
		return Config{}, err
	}
	if kit.Format != "kimono-recovery-v1" || !strings.HasPrefix(kit.Repository, "s3:https://") {
		return Config{}, fmt.Errorf("unsupported recovery kit")
	}
	u, err := url.Parse(strings.TrimPrefix(kit.Repository, "s3:"))
	if err != nil {
		return Config{}, err
	}
	parts := strings.Split(strings.TrimPrefix(u.Path, "/"), "/")
	if len(parts) != 2 || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return Config{}, fmt.Errorf("invalid recovery repository")
	}
	c := Config{Version: 1, Endpoint: u.Scheme + "://" + u.Host, Bucket: parts[0], Prefix: parts[1], KeyID: kit.KeyID, ApplicationKey: kit.ApplicationKey, Password: kit.Password, RecoverySaved: true, HourUTC: 3, Daily: 7, Weekly: 4, Monthly: 6, Platform: true, Apps: map[string]bool{}, Items: map[string]bool{}}
	if err := c.Validate(); err != nil {
		return Config{}, err
	}
	return c, nil
}

// ImportKit restores repository access without minting a different encryption
// password. Scheduling stays disabled until the administrator reviews coverage.
func (w *Worker) ImportKit(file string) error { return w.ImportKitWithSettings(file, "") }

// ImportKitWithSettings also brings back the schedule and selections a
// snapshot saved (platform/backup-settings.json), so a server restored from
// that snapshot carries on backing up exactly as before.
func (w *Worker) ImportKitWithSettings(file, settingsFile string) error {
	c, err := KitConfig(file)
	if err != nil {
		return err
	}
	message := "Recovery access imported. Scheduling is paused; check stored data to load the snapshot list."
	if settingsFile != "" {
		var saved Settings
		if err := readJSON(settingsFile, &saved); err != nil {
			return fmt.Errorf("read saved backup settings: %w", err)
		}
		c.Enabled, c.HourUTC, c.Daily, c.Weekly, c.Monthly, c.Platform = saved.Enabled, saved.HourUTC, saved.Daily, saved.Weekly, saved.Monthly, saved.Platform
		if saved.Apps != nil {
			c.Apps = saved.Apps
		}
		if saved.Items != nil {
			c.Items = saved.Items
		}
		if err := c.Validate(); err != nil {
			return err
		}
		message = "Restored from backup with its saved schedule and selections."
	}
	return w.locked(func() error {
		target := filepath.Join(w.dir(), "config.json")
		if err := writeJSON(target, c, 0600); err != nil {
			return err
		}
		// A root CLI import must leave settings editable/readable by the Portal's
		// existing state owner, without making credentials world-readable.
		if os.Geteuid() == 0 {
			info, err := os.Stat(w.State)
			if err != nil {
				return err
			}
			owner, ok := info.Sys().(*syscall.Stat_t)
			if !ok {
				return fmt.Errorf("cannot determine Portal state owner")
			}
			for _, path := range []string{w.dir(), target} {
				if err := os.Chown(path, int(owner.Uid), int(owner.Gid)); err != nil {
					return err
				}
			}
		}
		status := Status{State: "ready", Message: message}
		return w.saveStatus(&status)
	})
}
