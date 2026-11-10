package main

// Subtitles: ffmpeg turns a text track (SRT, ASS, WebVTT) into one WebVTT
// stream with the file's own times; the cues are kept, and each segment's
// file is made from the cues that overlap it.

import (
	"bufio"
	"fmt"
	"io"
	"sort"
	"strconv"
	"strings"
)

type cue struct {
	start, end float64
	settings   string
	text       string
}

func parseStamp(s string) (float64, bool) {
	parts := strings.Split(strings.TrimSpace(s), ":")
	if len(parts) < 2 || len(parts) > 3 {
		return 0, false
	}
	total := 0.0
	for _, p := range parts {
		v, err := strconv.ParseFloat(p, 64)
		if err != nil {
			return 0, false
		}
		total = total*60 + v
	}
	return total, true
}

func stamp(seconds float64) string {
	if seconds < 0 {
		seconds = 0
	}
	ms := int64(seconds*1000 + 0.5)
	return fmt.Sprintf("%02d:%02d:%02d.%03d", ms/3600000, ms/60000%60, ms/1000%60, ms%1000)
}

// readCues reads a WebVTT stream, calling onCue for each cue as it ends.
func readCues(r io.Reader, onCue func(cue)) error {
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, 64*1024), 1<<20)
	var block []string
	flush := func() {
		defer func() { block = block[:0] }()
		for i, line := range block {
			if !strings.Contains(line, "-->") {
				continue
			}
			arrow := strings.SplitN(line, "-->", 2)
			start, ok1 := parseStamp(arrow[0])
			rest := strings.Fields(arrow[1])
			if len(rest) == 0 {
				return
			}
			end, ok2 := parseStamp(rest[0])
			if !ok1 || !ok2 || end < start {
				return
			}
			text := strings.TrimSpace(strings.Join(block[i+1:], "\n"))
			if text != "" {
				onCue(cue{start: start, end: end, settings: strings.Join(rest[1:], " "), text: text})
			}
			return
		}
	}
	for scanner.Scan() {
		line := strings.TrimRight(scanner.Text(), "\r")
		if line == "" {
			flush()
			continue
		}
		block = append(block, line)
	}
	flush()
	return scanner.Err()
}

// vttSegment is the WebVTT file for [from, to): cues keep the file's own
// times, which are the media's times since the video keeps them too.
func vttSegment(cues []cue, from, to float64) []byte {
	var b strings.Builder
	b.WriteString("WEBVTT\nX-TIMESTAMP-MAP=MPEGTS:0,LOCAL:00:00:00.000\n\n")
	for _, c := range cues {
		if c.end <= from || c.start >= to {
			continue
		}
		b.WriteString(stamp(c.start) + " --> " + stamp(c.end))
		if c.settings != "" {
			b.WriteString(" " + c.settings)
		}
		b.WriteString("\n" + c.text + "\n\n")
	}
	return []byte(b.String())
}

// addCue keeps cues sorted and drops the repeats a restart brings.
func addCue(cues []cue, c cue) []cue {
	i := sort.Search(len(cues), func(i int) bool { return cues[i].start >= c.start })
	for j := i; j < len(cues) && cues[j].start == c.start; j++ {
		if cues[j].end == c.end && cues[j].text == c.text {
			return cues
		}
	}
	cues = append(cues, cue{})
	copy(cues[i+1:], cues[i:])
	cues[i] = c
	return cues
}
