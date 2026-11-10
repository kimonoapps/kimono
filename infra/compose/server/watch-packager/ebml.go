package main

// Keyframes from a Matroska file's Cues, read with a few ranged requests:
// the head (EBML header, SeekHead, Info, Tracks), then the Cues wherever the
// SeekHead says they are (usually the end). This is what lets a copied stream
// be cut into segments that start exactly on keyframes without reading the
// file through.

import (
	"errors"
	"fmt"
	"math"
	"sort"
)

const (
	idEBML        = 0x1A45DFA3
	idSegment     = 0x18538067
	idSeekHead    = 0x114D9B74
	idSeek        = 0x4DBB
	idSeekID      = 0x53AB
	idSeekPos     = 0x53AC
	idInfo        = 0x1549A966
	idTimecode    = 0x2AD7B1
	idTracks      = 0x1654AE6B
	idTrackEntry  = 0xAE
	idTrackNumber = 0xD7
	idTrackType   = 0x83
	idCues        = 0x1C53BB6B
	idCuePoint    = 0xBB
	idCueTime     = 0xB3
	idCuePos      = 0xB7
	idCueTrack    = 0xF7
	idCluster     = 0x1F43B675
)

// fetcher reads n bytes at off (fewer at the end of the file).
type fetcher func(off, n int64) ([]byte, error)

type element struct {
	id         uint64
	dataStart  int64 // offset of the data, relative to the buffer
	size       int64 // -1 when unknown
	headerSize int64
}

func vint(b []byte, keepMarker bool) (uint64, int, error) {
	if len(b) == 0 {
		return 0, 0, errors.New("short vint")
	}
	first := b[0]
	length := 1
	for mask := byte(0x80); length <= 8 && first&mask == 0; mask >>= 1 {
		length++
	}
	if length > 8 || len(b) < length {
		return 0, 0, errors.New("bad vint")
	}
	value := uint64(first)
	if !keepMarker {
		value &= uint64(0xFF >> length)
	}
	for i := 1; i < length; i++ {
		value = value<<8 | uint64(b[i])
	}
	return value, length, nil
}

func readElement(b []byte, at int64) (element, error) {
	if at >= int64(len(b)) {
		return element{}, errors.New("past the end")
	}
	id, idLen, err := vint(b[at:], true)
	if err != nil {
		return element{}, err
	}
	size, sizeLen, err := vint(b[at+int64(idLen):], false)
	if err != nil {
		return element{}, err
	}
	e := element{id: id, dataStart: at + int64(idLen+sizeLen), size: int64(size), headerSize: int64(idLen + sizeLen)}
	if size == (uint64(1)<<(7*sizeLen))-1 {
		e.size = -1
	}
	return e, nil
}

func uintOf(b []byte) uint64 {
	var v uint64
	for _, c := range b {
		v = v<<8 | uint64(c)
	}
	return v
}

// children walks the elements inside b[start:end], calling visit for each.
func children(b []byte, start, end int64, visit func(e element, data []byte) bool) error {
	for at := start; at < end && at < int64(len(b)); {
		e, err := readElement(b, at)
		if err != nil {
			return err
		}
		if e.size < 0 {
			return nil
		}
		stop := e.dataStart + e.size
		if stop > int64(len(b)) {
			if !visit(e, nil) {
				return nil
			}
			return nil
		}
		if !visit(e, b[e.dataStart:stop]) {
			return nil
		}
		at = stop
	}
	return nil
}

// matroskaKeyframes returns the video keyframe times in seconds, sorted.
func matroskaKeyframes(fetch fetcher) ([]float64, error) {
	head, err := fetch(0, 256*1024)
	if err != nil {
		return nil, err
	}
	first, err := readElement(head, 0)
	if err != nil || first.id != idEBML {
		return nil, errors.New("not Matroska")
	}
	seg, err := readElement(head, first.dataStart+first.size)
	if err != nil || seg.id != idSegment {
		return nil, errors.New("no Segment")
	}
	segStart := seg.dataStart
	timescale := uint64(1_000_000)
	videoTrack := uint64(0)
	positions := map[uint64]int64{}
	var cues []byte

	parseInfo := func(data []byte) {
		_ = children(data, 0, int64(len(data)), func(e element, d []byte) bool {
			if e.id == idTimecode && d != nil {
				timescale = uintOf(d)
			}
			return true
		})
	}
	parseTracks := func(data []byte) {
		_ = children(data, 0, int64(len(data)), func(e element, d []byte) bool {
			if e.id != idTrackEntry || d == nil {
				return true
			}
			var number, kind uint64
			_ = children(d, 0, int64(len(d)), func(f element, v []byte) bool {
				switch f.id {
				case idTrackNumber:
					number = uintOf(v)
				case idTrackType:
					kind = uintOf(v)
				}
				return true
			})
			if kind == 1 && videoTrack == 0 {
				videoTrack = number
			}
			return true
		})
	}
	seen := map[uint64]bool{}
	_ = children(head, segStart, int64(len(head)), func(e element, data []byte) bool {
		if e.id == idCluster {
			return false
		}
		if data == nil {
			return false
		}
		seen[e.id] = true
		switch e.id {
		case idSeekHead:
			_ = children(data, 0, int64(len(data)), func(s element, d []byte) bool {
				if s.id != idSeek || d == nil {
					return true
				}
				var which uint64
				var pos int64 = -1
				_ = children(d, 0, int64(len(d)), func(f element, v []byte) bool {
					switch f.id {
					case idSeekID:
						which = uintOf(v)
					case idSeekPos:
						pos = int64(uintOf(v))
					}
					return true
				})
				if which != 0 && pos >= 0 {
					positions[which] = pos
				}
				return true
			})
		case idInfo:
			parseInfo(data)
		case idTracks:
			parseTracks(data)
		case idCues:
			cues = data
		}
		return true
	})

	load := func(id uint64) ([]byte, error) {
		pos, ok := positions[id]
		if !ok {
			return nil, fmt.Errorf("no position for %x", id)
		}
		at := segStart + pos
		header, err := fetch(at, 16)
		if err != nil {
			return nil, err
		}
		e, err := readElement(header, 0)
		if err != nil || e.id != id || e.size < 0 {
			return nil, fmt.Errorf("element %x isn't where the SeekHead says", id)
		}
		if e.size > 64<<20 {
			return nil, errors.New("element too large")
		}
		return fetch(at+e.headerSize, e.size)
	}
	if !seen[idInfo] {
		if data, err := load(idInfo); err == nil {
			parseInfo(data)
		}
	}
	if !seen[idTracks] {
		if data, err := load(idTracks); err == nil {
			parseTracks(data)
		}
	}
	if cues == nil {
		if cues, err = load(idCues); err != nil {
			return nil, err
		}
	}
	scale := float64(timescale) / 1e9
	set := map[uint64]bool{}
	_ = children(cues, 0, int64(len(cues)), func(e element, data []byte) bool {
		if e.id != idCuePoint || data == nil {
			return true
		}
		var t uint64
		matches := videoTrack == 0
		_ = children(data, 0, int64(len(data)), func(f element, v []byte) bool {
			switch f.id {
			case idCueTime:
				t = uintOf(v)
			case idCuePos:
				_ = children(v, 0, int64(len(v)), func(g element, w []byte) bool {
					if g.id == idCueTrack && uintOf(w) == videoTrack {
						matches = true
					}
					return true
				})
			}
			return true
		})
		if matches {
			set[t] = true
		}
		return true
	})
	times := make([]float64, 0, len(set))
	for t := range set {
		times = append(times, math.Round(float64(t)*scale*1000)/1000)
	}
	sort.Float64s(times)
	if len(times) < 2 {
		return nil, errors.New("too few cues")
	}
	return times, nil
}
