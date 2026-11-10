package main

// Splitting ffmpeg's fragmented MP4 into HLS segments. ffmpeg writes one
// continuous stream per rendition (fragment at every keyframe, absolute
// decode times, no edit lists), so the init segment is the same whichever
// point it started from, and each fragment's time says which planned segment
// it belongs to. Segments are cut where the plan says, not where ffmpeg would.

import (
	"bufio"
	"encoding/binary"
	"errors"
	"io"
)

type track struct {
	id        uint32
	timescale uint32
	video     bool
}

type fragment struct {
	time float64 // seconds, of the video track's first sample (decode time)
	end  float64 // seconds, where its video ends; 0 when unknown
	data []byte
}

func readBox(r *bufio.Reader) ([]byte, string, error) {
	header := make([]byte, 8)
	if _, err := io.ReadFull(r, header); err != nil {
		return nil, "", err
	}
	size := uint64(binary.BigEndian.Uint32(header))
	kind := string(header[4:8])
	box := header
	if size == 1 {
		large := make([]byte, 8)
		if _, err := io.ReadFull(r, large); err != nil {
			return nil, "", err
		}
		size = binary.BigEndian.Uint64(large)
		box = append(box, large...)
	}
	if size == 0 {
		return nil, "", errors.New("open-ended box")
	}
	if size < uint64(len(box)) || size > 1<<31 {
		return nil, "", errors.New("bad box size")
	}
	body := make([]byte, int(size)-len(box))
	if _, err := io.ReadFull(r, body); err != nil {
		return nil, "", err
	}
	return append(box, body...), kind, nil
}

// walk calls visit for each child box of b[start:]; header sizes are 8 or 16.
func walk(b []byte, visit func(kind string, box []byte, bodyAt int)) {
	for at := 0; at+8 <= len(b); {
		size := int(binary.BigEndian.Uint32(b[at:]))
		head := 8
		if size == 1 && at+16 <= len(b) {
			size = int(binary.BigEndian.Uint64(b[at+8:]))
			head = 16
		}
		if size < head || at+size > len(b) {
			return
		}
		visit(string(b[at+4:at+8]), b[at:at+size], head)
		at += size
	}
}

func fullBody(box []byte, bodyAt int) []byte { return box[bodyAt:] }

// tracksOf reads track ids, timescales and kinds from a moov box.
func tracksOf(moov []byte) map[uint32]*track {
	out := map[uint32]*track{}
	walk(moov[8:], func(kind string, trak []byte, at int) {
		if kind != "trak" {
			return
		}
		t := &track{}
		walk(trak[at:], func(kind string, box []byte, at int) {
			body := box[at:]
			switch kind {
			case "tkhd":
				if len(body) < 24 {
					return
				}
				if body[0] == 1 {
					t.id = binary.BigEndian.Uint32(body[20:])
				} else {
					t.id = binary.BigEndian.Uint32(body[12:])
				}
			case "mdia":
				walk(body, func(kind string, box []byte, at int) {
					b := box[at:]
					switch kind {
					case "mdhd":
						if len(b) < 24 {
							return
						}
						if b[0] == 1 {
							t.timescale = binary.BigEndian.Uint32(b[20:])
						} else {
							t.timescale = binary.BigEndian.Uint32(b[12:])
						}
					case "hdlr":
						if len(b) >= 12 {
							t.video = string(b[8:12]) == "vide"
						}
					}
				})
			}
		})
		if t.id != 0 && t.timescale != 0 {
			out[t.id] = t
		}
	})
	return out
}

// fragmentTime reads a moof's decode time for its video track (else any
// track) and where that track's samples end, clamping a negative time
// (audio priming) to zero in place.
func fragmentTime(moof []byte, tracks map[uint32]*track) (float64, float64, bool) {
	best, end, found, video := 0.0, 0.0, false, false
	walk(moof[8:], func(kind string, traf []byte, at int) {
		if kind != "traf" {
			return
		}
		var id uint32
		var defaultDuration, total uint64
		var start float64
		walk(traf[at:], func(kind string, box []byte, at int) {
			body := box[at:]
			switch kind {
			case "tfhd":
				if len(body) >= 8 {
					id = binary.BigEndian.Uint32(body[4:])
					flags := binary.BigEndian.Uint32(body) & 0xffffff
					off := 8
					if flags&0x1 != 0 {
						off += 8
					}
					if flags&0x2 != 0 {
						off += 4
					}
					if flags&0x8 != 0 && len(body) >= off+4 {
						defaultDuration = uint64(binary.BigEndian.Uint32(body[off:]))
					}
				}
			case "trun":
				if len(body) < 8 {
					return
				}
				flags := binary.BigEndian.Uint32(body) & 0xffffff
				count := int(binary.BigEndian.Uint32(body[4:]))
				off := 8
				if flags&0x1 != 0 {
					off += 4
				}
				if flags&0x4 != 0 {
					off += 4
				}
				if flags&0x100 == 0 {
					total += uint64(count) * defaultDuration
					return
				}
				stride := 4
				for _, bit := range []uint32{0x200, 0x400, 0x800} {
					if flags&bit != 0 {
						stride += 4
					}
				}
				for i := 0; i < count && off+4 <= len(body); i++ {
					total += uint64(binary.BigEndian.Uint32(body[off:]))
					off += stride
				}
			case "tfdt":
				t := tracks[id]
				if t == nil || len(body) < 8 {
					return
				}
				var value int64
				if body[0] == 1 && len(body) >= 12 {
					value = int64(binary.BigEndian.Uint64(body[4:]))
					if value < 0 {
						binary.BigEndian.PutUint64(body[4:], 0)
						value = 0
					}
				} else {
					value = int64(binary.BigEndian.Uint32(body[4:]))
				}
				start = float64(value) / float64(t.timescale)
			}
		})
		t := tracks[id]
		if t == nil {
			return
		}
		if t.video && !video {
			best, found, video = start, true, true
			if total > 0 {
				end = start + float64(total)/float64(t.timescale)
			}
		} else if !found {
			best, found = start, true
		}
	})
	return best, end, found
}

// splitFragments reads a fragmented MP4 stream: onInit once with the init
// segment, then onFragment for each moof with its following boxes.
func splitFragments(r io.Reader, onInit func([]byte), onFragment func(fragment)) error {
	br := bufio.NewReaderSize(r, 1<<20)
	var init []byte
	var tracks map[uint32]*track
	var pending *fragment
	for {
		box, kind, err := readBox(br)
		if err != nil {
			if pending != nil {
				onFragment(*pending)
			}
			if errors.Is(err, io.EOF) {
				return nil
			}
			return err
		}
		switch {
		case tracks == nil && kind != "moof":
			init = append(init, box...)
			if kind == "moov" {
				tracks = tracksOf(box)
			}
		case kind == "moof":
			if tracks == nil {
				return errors.New("fragment before moov")
			}
			if init != nil {
				onInit(init)
				init = nil
			}
			if pending != nil {
				onFragment(*pending)
			}
			t, end, _ := fragmentTime(box, tracks)
			pending = &fragment{time: t, end: end, data: box}
		default:
			if pending != nil {
				pending.data = append(pending.data, box...)
				/* A fragment is whole once its media is in. */
				if kind == "mdat" {
					onFragment(*pending)
					pending = nil
				}
			}
		}
	}
}
