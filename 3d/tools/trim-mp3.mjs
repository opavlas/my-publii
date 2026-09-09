// Trim an MP3 on frame boundaries — no re-encode, so no generation loss and no
// ffmpeg dependency. MPEG-1 Layer III frames are self-contained enough for this:
// we keep whole frames from 0 to `seconds` and drop the rest.
import fs from 'node:fs'

const [, , src, dst, secondsArg] = process.argv
const seconds = Number(secondsArg)
const b = fs.readFileSync(src)

const BITRATES = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0]
const RATES = [44100, 48000, 32000]

let i = 0
if (b.slice(0, 3).toString() === 'ID3') {
  const sz = (b[6] << 21) | (b[7] << 14) | (b[8] << 7) | b[9]
  i = 10 + sz
}
const start = i

let t = 0
let frames = 0
let end = b.length

while (i < b.length - 4) {
  if (b[i] !== 0xFF || (b[i + 1] & 0xE0) !== 0xE0) { i++; continue }
  const verBits = (b[i + 1] >> 3) & 0x03          // 3 = MPEG1
  const brIdx = (b[i + 2] >> 4) & 0x0F
  const srIdx = (b[i + 2] >> 2) & 0x03
  const pad = (b[i + 2] >> 1) & 0x01
  const br = BITRATES[brIdx]
  const sr = RATES[srIdx]
  if (!br || !sr || verBits !== 3) { i++; continue }

  const frameLen = Math.floor((144 * br * 1000) / sr) + pad
  if (frameLen < 4) { i++; continue }

  const frameDur = 1152 / sr
  if (t + frameDur > seconds) { end = i; break }
  t += frameDur
  frames++
  i += frameLen
}

const out = b.slice(0, start).length ? Buffer.concat([b.slice(0, start), b.slice(start, end)]) : b.slice(start, end)
fs.writeFileSync(dst, out)

console.log(`frames kept   : ${frames}`)
console.log(`audio length  : ${t.toFixed(2)} s  (asked for <= ${seconds})`)
console.log(`bytes         : ${b.length} -> ${out.length}  (${(out.length / 1048576).toFixed(2)} MB, was ${(b.length / 1048576).toFixed(2)} MB)`)
