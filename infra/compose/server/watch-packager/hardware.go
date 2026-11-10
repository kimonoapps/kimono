package main

// Which encoder this machine has, found by trying each: NVIDIA (NVENC),
// Intel (Quick Sync), then any VAAPI GPU (AMD, older Intel), else software.
// The Portal builds the ffmpeg arguments for whichever is found, with a
// software version to fall back on.

import (
	"context"
	"log"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"
)

type hardware struct {
	Kind   string `json:"kind"` // "nvenc", "qsv", "vaapi" or "software"
	Device string `json:"device,omitempty"`
	// Filters this ffmpeg has, for tone-mapping HDR in software.
	Tonemapx bool `json:"tonemapx"`
	Zscale   bool `json:"zscale"`
}

var found = struct {
	sync.Mutex
	hw    hardware
	ready chan struct{}
}{ready: make(chan struct{})}

func currentHardware() hardware {
	select {
	case <-found.ready:
	case <-time.After(30 * time.Second):
	}
	found.Lock()
	defer found.Unlock()
	return found.hw
}

func try(args ...string) bool {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	base := []string{"-hide_banner", "-v", "error", "-nostdin"}
	return exec.CommandContext(ctx, ffmpegPath, append(base, args...)...).Run() == nil
}

func hasFilter(name string) bool {
	out, err := exec.Command(ffmpegPath, "-hide_banner", "-filters").Output()
	return err == nil && strings.Contains(string(out), " "+name+" ")
}

func detectHardware() {
	hw := hardware{Kind: "software", Tonemapx: hasFilter("tonemapx"), Zscale: hasFilter("zscale")}
	test := []string{"-f", "lavfi", "-i", "testsrc2=s=1280x720:r=24", "-frames:v", "5"}
	render := ""
	for _, candidate := range []string{"/dev/dri/renderD128", "/dev/dri/renderD129"} {
		if _, err := os.Stat(candidate); err == nil {
			render = candidate
			break
		}
	}
	switch {
	case os.Getenv("KIMONO_PACKAGER_HARDWARE") == "software":
	case try(append([]string{"-init_hw_device", "cuda=cu:0", "-filter_hw_device", "cu"}, append(test, "-vf", "format=nv12,hwupload_cuda", "-c:v", "h264_nvenc", "-f", "null", "-")...)...):
		hw.Kind = "nvenc"
	case render != "" && try(append([]string{"-init_hw_device", "vaapi=va:" + render, "-init_hw_device", "qsv=qs@va", "-filter_hw_device", "qs"}, append(test, "-vf", "format=nv12,hwupload=extra_hw_frames=64", "-c:v", "h264_qsv", "-f", "null", "-")...)...):
		hw.Kind, hw.Device = "qsv", render
	case render != "" && try(append([]string{"-init_hw_device", "vaapi=va:" + render, "-filter_hw_device", "va"}, append(test, "-vf", "format=nv12,hwupload", "-c:v", "h264_vaapi", "-f", "null", "-")...)...):
		hw.Kind, hw.Device = "vaapi", render
	}
	log.Printf("encoding with %s (tonemapx %v, zscale %v)", hw.Kind, hw.Tonemapx, hw.Zscale)
	found.Lock()
	found.hw = hw
	found.Unlock()
	close(found.ready)
}
