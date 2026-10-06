// Render /3d/film.html to a 4K video file.
//
//   npm install --no-save puppeteer-core ffmpeg-static     (once, from this dir)
//   node render-film.mjs                                   the whole film
//   node render-film.mjs --probe 6,20,37.5,45,58           stills, for eyeballing
//   node render-film.mjs --trace 23.5                      caption/label timing check
//
// Output lands in 3d/out/, which .gitignore keeps out of the published site.
//
// ---------------------------------------------------------------------------
// Why this is not just "screen-record the page"
//
// The film is REAL TIME. A 3840x2160 screenshot takes the better part of a
// second to come back, so between two captured frames the wall clock runs about
// fifty times further than film time. Anything the wall clock drives would be
// finished before the next frame was taken — every 0.9 s caption fade would read
// as a hard cut, and the detector canvases would integrate against a dt that has
// nothing to do with the picture.
//
// So the film's clock is driven by hand instead. film.js's ?render=1 mode (see
// setupRender there) stops the requestAnimationFrame loop and exposes
// __film.frame(i, fps); this asks for frame after frame at a fixed 1/fps, and
// hand-seeks the CSS transitions that carry the captions and the leader labels
// against that same clock. The result is frame-exact rather than "close enough",
// and it does not matter how slow the machine rendering it is.
//
// Why 1920x1080 at deviceScaleFactor 2, and not a literal 3840x2160 viewport:
// the page sizes its type with clamp()/vw against a ~1080p layout and its label
// text in fixed px, so a 4K CSS viewport would lay the film out for a wall and
// leave the captions the size of a postage stamp. A 1080p layout rasterised at
// 2x is the same film the page has always been, at four times the pixels.
//
// The score is not played in the browser at all — audio cannot be captured from
// a screenshot. assets/score.mp3 is laid under the picture by ffmpeg at the end,
// carrying the same head and tail fade that film-score.js's envelope() applies.

import http from 'node:http'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import puppeteer from 'puppeteer-core'

const require = createRequire(import.meta.url)
const HERE = path.dirname(fileURLToPath(import.meta.url))
const SITE = path.resolve(HERE, '..')          // the /3d/ directory this serves
const SCORE = path.join(SITE, 'assets', 'score.mp3')

const arg = (name, dflt) => {
  const i = process.argv.indexOf('--' + name)
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1] : (process.argv.includes('--' + name) ? true : dflt)
}

const FPS = Number(arg('fps', 60))
const CSS_W = Number(arg('width', 1920))
const CSS_H = Number(arg('height', 1080))
const DPR = Number(arg('dpr', 2))              // 1920x1080 @ 2 == 3840x2160
const PROBE = arg('probe', null)
const TRACE = arg('trace', null)
const FROM = Number(arg('from', 0))
const TO = arg('to', null) === null ? null : Number(arg('to'))
const CRF = String(arg('crf', 14))             // measured at 54 dB luma PSNR — transparent
const PRESET = String(arg('preset', 'slow'))
const OUT = String(arg('out', path.join(SITE, 'out', 'hardpix-film-2160p60.mp4')))

// Chrome, not a downloaded Chromium: the film needs a real GPU, and the browser
// already installed is the one whose driver is set up for this machine. Headless
// Chrome reaches the GPU through ANGLE/D3D11 on Windows — the boot log prints
// which renderer it actually got, so a silent fall back to software is visible.
const CHROME = String(arg('chrome', process.env.CHROME_PATH || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
].find(p => fs.existsSync(p)) || ''))

const FFMPEG = String(arg('ffmpeg', (() => {
  try { return require('ffmpeg-static') } catch { return 'ffmpeg' }
})()))

// ------------------------------------------------------------------ static server
// The page fetches hits.bin and imports ES modules, so file:// will not do.
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.glb': 'model/gltf-binary', '.bin': 'application/octet-stream',
  '.mp3': 'audio/mpeg', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.avif': 'image/avif', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8',
}
function serve(root) {
  const server = http.createServer(async (req, res) => {
    try {
      const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html'
      const file = path.join(root, rel)
      if (!path.resolve(file).startsWith(path.resolve(root))) { res.writeHead(403).end(); return }
      const stat = await fsp.stat(file)
      res.writeHead(200, {
        'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'content-length': stat.size,
        'cache-control': 'no-store',
      })
      fs.createReadStream(file).pipe(res)
    } catch { res.writeHead(404).end('not found') }
  })
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({ server, port: server.address().port })))
}

// ------------------------------------------------------------------ browser
async function openFilm(port) {
  if (!CHROME) throw new Error('no Chrome found — pass --chrome <path> or set CHROME_PATH')
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    protocolTimeout: 600_000,
    args: [
      '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--mute-audio',
      '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--use-angle=d3d11',
      // A headless page can be treated as backgrounded, and a throttled compositor
      // is a throttled rAF — which is what __film.frame() waits on before a capture.
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      '--disable-features=CalculateNativeWinOcclusion',
      '--js-flags=--max-old-space-size=8192',        // the .glb is ~89 MB
    ],
  })
  const page = await browser.newPage()
  page.on('console', m => { if (/^FILM/.test(m.text())) console.log('  [page]', m.text().split('\n')[0].slice(0, 200)) })
  page.on('pageerror', e => console.log('  [page error]', e.message))

  // Before goto, not after: buildTimeline() solves every shot against the
  // viewport aspect at module boot, so a later resize would not re-frame them.
  await page.setViewport({ width: CSS_W, height: CSS_H, deviceScaleFactor: DPR })
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }])

  const t0 = Date.now()
  await page.goto(`http://127.0.0.1:${port}/film.html?render=1`, { waitUntil: 'domcontentloaded', timeout: 300_000 })
  // Wait on the film, not on a timeout: setupRender() publishes __film only once
  // the .glb, the moon texture and hits.bin are all in and the scene is built.
  await page.waitForFunction('window.__film || window.__filmError', { timeout: 600_000, polling: 500 })
  const err = await page.evaluate(() => window.__filmError || null)
  if (err) throw new Error('film failed to load: ' + err)

  const info = await page.evaluate(() => ({
    duration: window.__film.duration,
    buffer: [document.getElementById('canvas').width, document.getElementById('canvas').height],
    gl: (() => {
      const gl = document.createElement('canvas').getContext('webgl2')
      const d = gl.getExtension('WEBGL_debug_renderer_info')
      return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'unknown'
    })(),
  }))
  console.log(`  loaded in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  console.log(`  ${CSS_W}x${CSS_H} css @ dpr ${DPR} -> drawing buffer ${info.buffer.join('x')}`)
  console.log(`  gl: ${info.gl}`)
  if (/SwiftShader|software/i.test(info.gl)) console.log('  WARNING: software renderer — this will be extremely slow')
  console.log(`  film duration: ${info.duration.toFixed(2)}s`)
  return { browser, page, info }
}

const step = (page, i) => page.evaluate((i, fps) => window.__film.frame(i, fps), i, FPS)
const shoot = async page => Buffer.from(await page.screenshot({ type: 'png', optimizeForSpeed: true }))

// ------------------------------------------------------------------ probe
// The detector canvases accumulate over the whole film, so a still is only
// honest if the film has been stepped up to it. Step every frame, keep a few.
async function probe(page, times) {
  const dir = path.join(SITE, 'out', 'probe')
  await fsp.mkdir(dir, { recursive: true })
  const want = new Map(times.map(t => [Math.round(t * FPS), t]))
  const lastFrame = Math.max(...want.keys())
  for (let i = 0; i <= lastFrame; i++) {
    await step(page, i)
    if (!want.has(i)) continue
    const buf = await shoot(page)
    const f = path.join(dir, `t${String(want.get(i)).replace('.', '_')}.png`)
    await fsp.writeFile(f, buf)
    console.log(`  t=${want.get(i)}s  frame ${i}  ${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}  ${(buf.length / 1e6).toFixed(2)} MB`)
  }
  console.log(`  -> ${dir}`)
}

// ------------------------------------------------------------------ trace
// Proves the captions and labels are keyed to FILM time rather than to the wall
// clock — the one thing a still cannot show. Run this after changing a caption,
// a transition duration, or the label stagger.
async function trace(page, upToSeconds) {
  const last = Math.round(upToSeconds * FPS)
  const rows = []
  for (let i = 0; i <= last; i++) {
    await step(page, i)
    if (i % 6) continue
    rows.push(await page.evaluate(() => {
      const op = el => +getComputedStyle(el).opacity
      return {
        main: op(document.getElementById('cap-main')),
        sub: op(document.getElementById('cap-sub')),
        text: document.getElementById('cap-main').textContent.slice(0, 34),
        labs: [...document.querySelectorAll('#labels .label')].map(op),
        anims: document.getAnimations().length,
      }
    }))
  }
  console.log('\n  t      cap-main  cap-sub  anims  caption')
  rows.forEach((r, k) => console.log(
    `  ${((k * 6) / FPS).toFixed(2).padStart(6)}  ${r.main.toFixed(3).padStart(7)}  ${r.sub.toFixed(3).padStart(7)}` +
    `  ${String(r.anims).padStart(5)}  ${r.text}` +
    (r.labs.some(o => o > 0 && o < 1) ? `  labels[${r.labs.map(o => o.toFixed(2)).join(' ')}]` : '')))
  console.log(`\n  captions seen mid-fade: ${rows.some(r => r.main > 0.02 && r.main < 0.98)}` +
    `   labels seen mid-fade: ${rows.some(r => r.labs.some(o => o > 0.02 && o < 0.98))}` +
    `   peak live animations: ${Math.max(...rows.map(r => r.anims))} (must stay bounded)`)
}

// ------------------------------------------------------------------ encode
function startFfmpeg(totalFrames) {
  const seconds = totalFrames / FPS
  const ff = spawn(FFMPEG, [
    '-hide_banner', '-loglevel', 'warning', '-nostats', '-y',
    '-f', 'image2pipe', '-thread_queue_size', '512', '-framerate', String(FPS), '-i', 'pipe:0',
    '-i', SCORE,
    '-map', '0:v:0', '-map', '1:a:0',
    '-c:v', 'libx264', '-preset', PRESET, '-crf', CRF,
    '-profile:v', 'high', '-level', '5.2', '-pix_fmt', 'yuv420p',
    '-x264-params', 'ref=4:bframes=4:aq-mode=3:aq-strength=1.0:deblock=-1,-1',
    // Tagged, not assumed: an untagged 4K file is guessed as bt2020 by some players
    // and the copper accent comes back orange-brown.
    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
    // film-score.js fades the cue in and out itself so a licensed track never
    // starts or stops on a click; the file gets the same shape.
    '-af', `afade=t=in:st=0:d=1.2,afade=t=out:st=${Math.max(0, seconds - 1.6).toFixed(3)}:d=1.6`,
    '-c:a', 'aac', '-b:a', '320k', '-ar', '48000',
    '-t', seconds.toFixed(4),
    '-movflags', '+faststart',
    OUT,
  ], { stdio: ['pipe', 'inherit', 'inherit'] })
  ff.on('error', e => { console.error('ffmpeg failed to start:', e.message); process.exit(1) })
  return ff
}

const write = (s, buf) => s.write(buf) ? Promise.resolve() : new Promise(r => s.once('drain', r))

// ------------------------------------------------------------------ main
const { server, port } = await serve(SITE)
console.log(`serving ${SITE} on 127.0.0.1:${port}`)
const { browser, page, info } = await openFilm(port)

try {
  if (TRACE) {
    await trace(page, Number(TRACE))
  } else if (PROBE) {
    await probe(page, String(PROBE).split(',').map(Number))
  } else {
    // The timeline ends on tl.set({}, {}, 64), and stepping TO 64 would fire
    // onComplete — which hands the model to OrbitControls and raises the "Drag
    // to explore" hint. The last frame is 63.983s; the film is 64.000s long.
    const total = TO !== null ? TO : Math.round(info.duration * FPS)
    await fsp.mkdir(path.dirname(OUT), { recursive: true })
    console.log(`\nrendering frames ${FROM}..${total - 1} (${total - FROM} frames, ${((total - FROM) / FPS).toFixed(2)}s)`)
    console.log(`  -> ${OUT}\n`)
    const ff = startFfmpeg(total - FROM)
    const t0 = Date.now()
    let bytes = 0
    for (let i = FROM; i < total; i++) {
      await step(page, i)
      const shot = await shoot(page)
      bytes += shot.length
      await write(ff.stdin, shot)
      if ((i - FROM) % 120 !== 119) continue
      const done = i - FROM + 1, per = (Date.now() - t0) / done
      console.log(`  frame ${i}/${total - 1}  t=${(i / FPS).toFixed(2)}s  ${(per / 1000).toFixed(2)}s/frame` +
        `  eta ${((total - 1 - i) * per / 60000).toFixed(1)} min  avg png ${(bytes / done / 1e6).toFixed(2)} MB`)
    }
    ff.stdin.end()
    await new Promise(r => ff.on('close', r))
    console.log(`\ndone in ${((Date.now() - t0) / 60000).toFixed(1)} min` +
      `  ->  ${OUT}  ${((await fsp.stat(OUT)).size / 1e6).toFixed(1)} MB`)
  }
} finally {
  await browser.close()
  server.close()
}
