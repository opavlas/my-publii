#!/usr/bin/env python3
"""Pack a TrackLab frame dump into the binary the film reads (hits.bin).

    python pack_hits.py poland_m2_calib.txt hits.bin

INPUT FORMAT (TrackLab text dump)
    A '#' preamble (chip id, bias, clocks, DAC table), then repeating blocks of
        <pixelIndex> <ToA> <ToT> <unused>
    terminated by a line like
        # Frame:   0   Start time: 0.0   End time: 1.0   Hits: 4  ...

    NOTE the '# Frame:' line is a TRAILER that closes the block ABOVE it, not a
    header for the block below. Reading it as a header shifts every frame's
    label onto the next frame's pixels — which is exactly what the older
    hardpix.html page does. This script asserts the trailer reading by checking
    every frame's parsed hit count against its own 'Hits:' value; the supplied
    poland_m2_calib.txt matches on all 13,230 frames.

    Column 1 is a flat pixel index 0..65535 (x = i % 256, y = i // 256).
    Column 2 is an 18-bit ToA, saturated at 262143 in ~99% of rows, so it
    carries no usable intra-frame ordering and is discarded here.
    Column 3 is raw Time-over-Threshold clock counts (integers, 1..830 in this
    run) — NOT calibrated energy, despite the '_calib' filename. The film only
    ever calls it measured data, never keV.

OUTPUT FORMAT (little-endian, as read by assets/film.js:loadHits)
    magic   4 bytes  'HPX1'
    uint32           frame count N
    uint32           total hit count H
    uint32 * (N+1)   offsets: hits of frame i are [offsets[i], offsets[i+1])
    uint16 * 2 * H   per hit: pixel index, ToT
"""

import struct
import sys
import re

PAT = re.compile(r'# Frame:\s+(\d+).*?Hits:\s+(\d+)')


def parse(path):
    frames, labels, cur = [], [], []
    with open(path, encoding='utf-8', errors='replace') as f:
        for line in f:
            s = line.strip()
            if not s:
                continue
            if s.startswith('#'):
                m = PAT.search(s)
                if m:                                   # trailer: closes `cur`
                    frames.append(cur)
                    labels.append((int(m.group(1)), int(m.group(2))))
                    cur = []
                continue
            p = s.split()
            try:
                idx, tot = int(p[0]), int(float(p[2]))
            except (ValueError, IndexError):
                continue
            if 0 <= idx < 65536:
                cur.append((idx, min(tot, 65535)))
    if cur:                                             # trailing partial frame
        frames.append(cur)
    return frames, labels


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else 'poland_m2_calib.txt'
    dst = sys.argv[2] if len(sys.argv) > 2 else 'hits.bin'

    frames, labels = parse(src)
    mismatch = [(i, len(frames[i]), labels[i][1])
                for i in range(min(len(frames), len(labels)))
                if len(frames[i]) != labels[i][1]]
    if mismatch:
        print('WARNING: %d frames disagree with their Hits: label — the trailer '
              'convention may not hold for this file. First few: %s'
              % (len(mismatch), mismatch[:5]))

    total = sum(len(f) for f in frames)
    offsets = [0]
    for fr in frames:
        offsets.append(offsets[-1] + len(fr))

    buf = bytearray()
    buf += b'HPX1' + struct.pack('<II', len(frames), total)
    buf += struct.pack('<%dI' % len(offsets), *offsets)
    for fr in frames:
        for idx, tot in fr:
            buf += struct.pack('<HH', idx, tot)
    with open(dst, 'wb') as f:
        f.write(buf)

    counts = [len(f) for f in frames]
    print('%s -> %s' % (src, dst))
    print('  frames %d, hits %d, %.2f MB' % (len(frames), total, len(buf) / 1048576))
    print('  hits/frame: max %d (frame %d), median %d, empty %d'
          % (max(counts), counts.index(max(counts)),
             sorted(counts)[len(counts) // 2], counts.count(0)))
    print('  label check: %d/%d frames match their Hits: value'
          % (len(frames) - len(mismatch), len(frames)))
    print('\nIf you repack, re-check the constants in assets/film.js:')
    print('  HERO_FRAME  a frame with one clean dominant track (the "one particle" beat)')
    print('  STORM_IN / STORM_PEAK   the flux rise')
    print('  QUIET_FRAME the baseline stretch')


if __name__ == '__main__':
    main()
