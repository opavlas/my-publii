// HardPix2 — "Fourteen Millimetres"
// A ~64-second real-time product film. Plays once, then hands the model over to
// the viewer. three.js + GSAP come from the chunk the /3d/ pages already ship
// (see three-lib.js), so this page adds no new library bytes.
//
// NOTHING here is hard-coded to a particular .glb. Part roles, stacking order,
// explode offsets, sensor placement, the dimension caption and every camera are
// MEASURED at load by model-rig.js. Swapping MODEL_FILE for another revision is
// intended to just work; the boot log prints what was detected so a mismatch is
// visible rather than silent.

import {
  Scene, WebGLRenderer, PerspectiveCamera, Group, Mesh, Vector3, Box3, Color,
  PlaneGeometry, SphereGeometry, MeshBasicMaterial, CanvasTexture, TextureLoader,
  GLTFLoader, OrbitControls, RepeatWrapping, AmbientLight, DirectionalLight, gsap,
} from './three-lib.js'
import {
  normalise, discoverParts, explodeLayout, findSensor, fitBox, dirFrom, describe,
} from './model-rig.js'
import { createScore } from './film-score.js'

const MODEL_FILE = './HardPix2_TPX2_nano.glb'

// The score. Anything set here is served from this repo to every visitor, so
// only a track you hold publication rights to belongs in it — audition anything
// else with ?score=<path>, which points outside the committed tree.
//
// Currently: "Interstellar" by leberch, from Pixabay, free for use under the
// Pixabay Content License (commercial and website use permitted, no attribution
// required) — https://pixabay.com/music/ambient-interstellar-589820/
// The source is 2:40; assets/score.mp3 is its first 66 seconds, cut on MP3
// frame boundaries so it is not re-encoded. Set this to '' to go back to the
// synthesised cue in film-score.js, which is unchanged and still the fallback
// if this file ever fails to load.
//
// SCORE_OFFSET picks WHICH stretch of a longer track plays under the 64 seconds
// of picture: film second 0 becomes track second SCORE_OFFSET. It is 0 here
// because score.mp3 is already trimmed to the film. Audition another in-point
// against the untrimmed original with ?score-at=<seconds>.
const SCORE_FILE = './assets/score.mp3'
const SCORE_OFFSET = 0

// The housing. The CAD ships every shell on ONE material called
// "AluminumPolished" whose numbers are not aluminium at all: metalness 0.45 at
// roughness 0 is a half-dielectric mirror, which renders as dark glass under
// this lighting. These are the real thing — aluminium's F0 (near-white, faintly
// blue), fully metallic, at the roughness of a machined-and-bead-blasted
// enclosure rather than a shaving mirror.
const ALUMINIUM = { color: 0xf3f4f6, metalness: 1.0, roughness: 0.24, env: 1.85 }
const SHELL_ROLES = ['cover', 'frame', 'base']

// three.js numeric constants — the chunk exports the classes but not the enums.
const ADDITIVE = 2, NEAREST = 1003, LINEAR = 1006, DOUBLE_SIDE = 2

const $ = id => document.getElementById(id)
const ui = {
  loader: $('loader'), bar: $('bar'), pct: $('pct'), stage: $('stage'),
  capMain: $('cap-main'), capSub: $('cap-sub'), labels: $('labels'), capWrap: $('captions'),
  scrub: $('scrub'), played: $('played'), replay: $('replay'), hint: $('hint'),
  playpause: $('playpause'), posterBtn: $('poster-play'), sound: $('sound'),
}

// ---------------------------------------------------------------- score
const score = createScore({
  file: new URLSearchParams(location.search).get('score') || SCORE_FILE,
  offset: parseFloat(new URLSearchParams(location.search).get('score-at')) || SCORE_OFFSET,
})
function paintSound() {
  ui.sound.textContent = score.enabled ? (score.blocked ? 'Sound — click' : 'Sound on') : 'Sound off'
  ui.sound.setAttribute('aria-pressed', String(score.enabled))
  ui.sound.classList.toggle('armed', score.blocked)
}
// Whether audio is blocked is only discovered when a play attempt is refused,
// which happens well after boot — so the control has to be derived every frame
// like the captions and labels, not painted once. Without this the button sits
// on a stale "Sound on" while the film plays silently, and the viewer is never
// told that a click is all it wants.
let lastSoundState = null
function syncSound() {
  const state = (score.enabled ? 1 : 0) + '|' + (score.blocked ? 1 : 0)
  if (state === lastSoundState) return
  lastSoundState = state
  paintSound()
}

// ---------------------------------------------------------------- renderer
const canvas = $('canvas')
const renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.toneMapping = 4              // ACESFilmic
renderer.toneMappingExposure = 1.15
renderer.shadowMap.enabled = false    // 3600+ draw calls; a shadow pass doubles them

const scene = new Scene()
scene.background = new Color(0x0c0c0c)

// The housing material is AluminumPolished at roughness 0.0 — a near-mirror.
// Directional lights alone give a mirror almost nothing to return, so a smooth
// metal renders black. This tiny procedural equirect gives every reflective
// surface something to reflect; the renderer prefilters it once at load.
function buildEnvironment() {
  const c = document.createElement('canvas')
  c.width = 256; c.height = 128
  const g = c.getContext('2d')
  const sky = g.createLinearGradient(0, 0, 0, 128)
  sky.addColorStop(0.00, '#5a5f6b')      // zenith
  sky.addColorStop(0.45, '#2a2c33')
  sky.addColorStop(0.52, '#141416')      // horizon
  // A pure-metal shell reflects the environment and nothing else, so a black
  // lower hemisphere would leave every vertical face dead. This is the faint
  // floor bounce a real product shot gets from the table.
  sky.addColorStop(0.72, '#111114')
  sky.addColorStop(1.00, '#08080a')      // ground
  g.fillStyle = sky
  g.fillRect(0, 0, 256, 128)
  // a warm highlight where the key light sits, so edges catch a specular streak
  const warm = g.createRadialGradient(188, 34, 2, 188, 34, 54)
  warm.addColorStop(0, 'rgba(255,240,214,0.95)')
  warm.addColorStop(1, 'rgba(255,240,214,0)')
  g.fillStyle = warm
  g.fillRect(134, 0, 108, 88)
  const cool = g.createRadialGradient(60, 52, 2, 60, 52, 44)
  cool.addColorStop(0, 'rgba(150,175,210,0.5)')
  cool.addColorStop(1, 'rgba(150,175,210,0)')
  g.fillStyle = cool
  g.fillRect(16, 8, 88, 88)
  const tex = new CanvasTexture(c)
  tex.mapping = 303                       // EquirectangularReflectionMapping
  tex.colorSpace = 'srgb'
  return tex
}
scene.environment = buildEnvironment()

/**
 * A second, brighter environment used ONLY by the aluminium shells.
 *
 * A fully metallic surface has no diffuse response at all: every photon it
 * shows the camera is a reflection, so with the scene environment above — a
 * dark studio built for dielectric boards — the housing renders almost black.
 * Raising the scene environment instead would light the boards' diffuse IBL too
 * and change the look of the whole film, so the shells get their own.
 *
 * Note where the sources go. An equirect is sampled Y-up while this model is
 * Z-up, so the map's poles point along the instrument's SHORT axis and "above
 * the instrument" (world +Z) lands on the equator at u=0.75 — x=192, y=64 —
 * which is where the key softbox has to sit. Painting a gradient by latitude,
 * as a Y-up scene would, lights the thing sideways.
 */
function buildHousingEnvironment() {
  const c = document.createElement('canvas')
  c.width = 256; c.height = 128
  const g = c.getContext('2d')
  g.fillStyle = '#191b20'                      // the room the instrument sits in
  g.fillRect(0, 0, 256, 128)
  g.globalCompositeOperation = 'lighter'
  // Soft elliptical source, drawn three times so it wraps across the seam.
  const softbox = (cx, cy, rx, ry, colour, alpha) => {
    for (const ox of [-256, 0, 256]) {
      g.save()
      g.translate(cx + ox, cy)
      g.scale(rx, ry)
      const grad = g.createRadialGradient(0, 0, 0, 0, 0, 1)
      grad.addColorStop(0, 'rgba(' + colour + ',' + alpha + ')')
      grad.addColorStop(0.55, 'rgba(' + colour + ',' + (alpha * 0.45).toFixed(3) + ')')
      grad.addColorStop(1, 'rgba(' + colour + ',0)')
      g.fillStyle = grad
      g.beginPath(); g.arc(0, 0, 1, 0, Math.PI * 2); g.fill()
      g.restore()
    }
  }
  softbox(192, 64, 84, 108, '242,246,255', 1.00)   // key — directly over the instrument
  softbox(150, 26, 54, 40, '255,244,222', 0.55)    // warm kicker, along the key light
  softbox(238, 100, 52, 40, '150,178,220', 0.35)   // cool rim from behind
  softbox(64, 64, 76, 96, '48,52,62', 0.75)        // the floor it stands on, bounced back
  const tex = new CanvasTexture(c)
  tex.mapping = 303                       // EquirectangularReflectionMapping
  tex.colorSpace = 'srgb'
  return tex
}
const HOUSING_ENV = buildHousingEnvironment()

const camera = new PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.02, 3000)
camera.up.set(0, 0, 1)                // the model is Z-up

const ambient = new AmbientLight(0x404048, 0.30)
const key = new DirectionalLight(0xfff5e0, 3.4); key.position.set(3.5, -4.2, 5.0)
const fill = new DirectionalLight(0xa8c0e0, 0.42); fill.position.set(-4.5, 3.0, 1.8)
const rim = new DirectionalLight(0xb8703a, 1.5); rim.position.set(-2.2, -1.4, -3.0)
scene.add(ambient, key, fill, rim)
const LIGHT_LEVEL = { v: 0 }
const baseIntensity = { a: 0.30, k: 3.4, f: 0.42, r: 1.5 }
const housingMats = []          // the aluminium shells, filled in by build()
function applyLights() {
  const v = LIGHT_LEVEL.v
  ambient.intensity = baseIntensity.a * v
  key.intensity = baseIntensity.k * v
  fill.intensity = baseIntensity.f * v
  rim.intensity = baseIntensity.r * v
  // A fully metallic surface takes no diffuse light, so dimming the lamps alone
  // would leave the housing lit by the environment through the opening fade —
  // it has to build out of black with everything else.
  for (const m of housingMats) m.envMapIntensity = ALUMINIUM.env * v
}

// ---------------------------------------------------------------- loading
const progress = { glb: 0, moon: 0, hits: 0 }
const WEIGHT = { glb: 0.88, moon: 0.04, hits: 0.08 }
function reportProgress() {
  const p = progress.glb * WEIGHT.glb + progress.moon * WEIGHT.moon + progress.hits * WEIGHT.hits
  const pct = Math.min(100, Math.round(p * 100))
  ui.bar.style.width = pct + '%'
  ui.pct.textContent = pct
}
function loadModel() {
  return new Promise((res, rej) => new GLTFLoader().load(MODEL_FILE,
    g => res(g),
    e => { if (e.total) { progress.glb = e.loaded / e.total; reportProgress() } },
    rej))
}
function loadMoon() {
  return new Promise(res => new TextureLoader().load('./moon_2k.jpg',
    t => { progress.moon = 1; reportProgress(); res(t) },
    undefined,
    () => { progress.moon = 1; reportProgress(); res(null) }))
}
async function loadHits() {
  const r = await fetch('./data/hits.bin')
  if (!r.ok) throw new Error('hits.bin ' + r.status)
  const buf = await r.arrayBuffer()
  progress.hits = 1; reportProgress()
  const head = new Uint32Array(buf, 4, 2)
  const frameCount = head[0], hitCount = head[1]
  const offsets = new Uint32Array(buf.slice(12, 12 + 4 * (frameCount + 1)))
  const hits = new Uint16Array(buf.slice(12 + 4 * (frameCount + 1)))
  return { frameCount, hitCount, offsets, hits }
}

// ---------------------------------------------------------------- detector data
// hits.bin: 13,230 contiguous 1.000 s exposures from a Timepix2 chip (D7-W0016),
// repacked from data/poland_m2_calib.txt. Column 3 is raw Time-over-Threshold
// clock counts (1..830), NOT calibrated energy — the film never claims otherwise.
// The model's detectors are Timepix2, the same chip family as this data, but
// nothing establishes that these frames came from THIS unit, so the film says
// only that the data is real and measured.
const HERO_FRAME = 57      // 68 hits, one dominant 66-pixel track, 47 px long
const STORM_IN = 4200      // the flux starts climbing here
const STORM_PEAK = 7740    // 44x baseline
const QUIET_FRAME = 380    // baseline ~2 hits/s
const LOWER_OFFSET = 1163  // the lower layer is drawn from a different stretch of
                           // the same run: both layers really do see the storm,
                           // but the data is one chip, so it is never presented
                           // as a simultaneous two-layer coincidence.

const LUT = (() => {
  const stops = [[0, 46, 8, 2], [0.35, 184, 112, 58], [0.72, 255, 214, 160], [1, 255, 255, 255]]
  const out = []
  for (let i = 0; i < 64; i++) {
    const t = i / 63
    let a = stops[0], b = stops[stops.length - 1]
    for (let s = 0; s < stops.length - 1; s++) if (t >= stops[s][0] && t <= stops[s + 1][0]) { a = stops[s]; b = stops[s + 1] }
    const f = (t - a[0]) / Math.max(1e-6, b[0] - a[0])
    out.push([Math.round(a[1] + (b[1] - a[1]) * f), Math.round(a[2] + (b[2] - a[2]) * f), Math.round(a[3] + (b[3] - a[3]) * f)])
  }
  return out
})()
const MAX_TOT = 300 // log-normalised ceiling; p99.9 of the run is 337
function lutFor(tot) {
  const t = Math.min(1, Math.log10(1 + tot) / Math.log10(1 + MAX_TOT))
  return LUT[Math.min(63, Math.max(0, Math.round(t * 63)))]
}

let D = null

/**
 * One sensor screen: a crisp 256x256 canvas of pixel hits plus a soft canvas
 * faked as glow (the shipped three.js chunk has no post-processing stack).
 */
function makeScreen() {
  const crisp = document.createElement('canvas'); crisp.width = crisp.height = 256
  const cctx = crisp.getContext('2d'); cctx.imageSmoothingEnabled = false
  const glow = document.createElement('canvas'); glow.width = glow.height = 256
  const gctx = glow.getContext('2d')
  return {
    crisp, cctx, glow, gctx, planes: null,
    playhead: QUIET_FRAME, rate: 0, persist: 0.985, drawn: -1,
    paint(px, tot, soft) {
      const x = px % 256, y = 255 - ((px / 256) | 0)     // +Y up on the plane
      const c = lutFor(tot)
      this.cctx.fillStyle = 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')'
      this.cctx.fillRect(x, y, 1, 1)
      const r = soft ? 5 : 3
      const g = this.gctx.createRadialGradient(x, y, 0, x, y, r)
      g.addColorStop(0, 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',0.40)')
      g.addColorStop(1, 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',0)')
      this.gctx.fillStyle = g
      this.gctx.fillRect(x - r, y - r, r * 2, r * 2)
    },
    fade(dt) {
      const k = 1 - Math.pow(this.persist, dt * 60)
      this.cctx.globalCompositeOperation = 'destination-out'
      this.cctx.fillStyle = 'rgba(0,0,0,' + k.toFixed(4) + ')'
      this.cctx.fillRect(0, 0, 256, 256)
      this.cctx.globalCompositeOperation = 'source-over'
      this.gctx.globalCompositeOperation = 'destination-out'
      this.gctx.fillStyle = 'rgba(0,0,0,' + Math.min(1, k * 1.6).toFixed(4) + ')'
      this.gctx.fillRect(0, 0, 256, 256)
      this.gctx.globalCompositeOperation = 'source-over'
    },
    clear() {
      this.cctx.clearRect(0, 0, 256, 256)
      this.gctx.clearRect(0, 0, 256, 256)
      this.drawn = -1
    },
    advance(dt) {
      this.fade(dt)
      if (!D || this.rate === 0) return
      const next = this.playhead + this.rate * dt
      const from = Math.max(0, Math.floor(this.playhead))
      const to = Math.min(D.frameCount - 1, Math.floor(next))
      for (let f = Math.max(from, this.drawn + 1); f <= to; f++) {
        const s = D.offsets[f], e = D.offsets[f + 1]
        for (let k = s; k < e; k++) this.paint(D.hits[k * 2], D.hits[k * 2 + 1], false)
      }
      this.drawn = to
      this.playhead = next
    },
    upload() {
      if (!this.planes) return
      this.planes.crisp.material.map.needsUpdate = true
      this.planes.glow.material.map.needsUpdate = true
    },
  }
}
const screens = []          // [0] = upper detector, [1] = lower detector

// The hero track, ordered along its principal axis so it draws itself in.
// Only ever painted on the UPPER sensor: the track beat is a demonstration of
// how one layer detects a particle.
let heroOrdered = []
function buildHeroTrack() {
  const s = D.offsets[HERO_FRAME], e = D.offsets[HERO_FRAME + 1]
  const pts = []
  for (let k = s; k < e; k++) pts.push([D.hits[k * 2], D.hits[k * 2 + 1]])
  let mx = 0, my = 0
  pts.forEach(p => { mx += p[0] % 256; my += (p[0] / 256) | 0 })
  mx /= pts.length; my /= pts.length
  let sxx = 0, sxy = 0, syy = 0
  pts.forEach(p => { const x = p[0] % 256 - mx, y = ((p[0] / 256) | 0) - my; sxx += x * x; sxy += x * y; syy += y * y })
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy)
  const ax = Math.cos(theta), ay = Math.sin(theta)
  heroOrdered = pts.slice().sort((a, b) => {
    const pa = (a[0] % 256 - mx) * ax + (((a[0] / 256) | 0) - my) * ay
    const pb = (b[0] % 256 - mx) * ax + (((b[0] / 256) | 0) - my) * ay
    return pa - pb
  })
}
const hero = { progress: 0, shown: 0 }
function drawHeroProgress() {
  const n = Math.floor(hero.progress * heroOrdered.length)
  for (let i = hero.shown; i < n; i++) screens[0].paint(heroOrdered[i][0], heroOrdered[i][1], true)
  hero.shown = n
}

// ---------------------------------------------------------------- scene build
const pivot = new Group()
scene.add(pivot)
let parts = [], detectors = [], sensors = []
let OPEN = {}, EXIT = {}
let sky = null, controls = null, ghostable = []
let mmPerUnit = 1, housingCaption = ''
const labelEls = []

function build(gltf, moonTex) {
  const root = gltf.scene
  const scale = normalise(root, 5)
  mmPerUnit = 1000 / scale                       // glTF units are metres
  pivot.add(root)
  parts = discoverParts(root, pivot)
  console.log('FILM model: ' + MODEL_FILE + '\n' + describe(parts, mmPerUnit).join('\n'))

  detectors = parts.filter(p => p.role === 'detector')
  OPEN = explodeLayout(parts, 0.30)

  // The still point keeps every detector layer on screen (this revision has two)
  // and sends the rest of the stack out of frame, preserving stack order.
  const keep = new Set(detectors)
  const topDet = detectors[0], botDet = detectors[detectors.length - 1]
  const above = parts.filter(p => !keep.has(p) && p.centre.z > (topDet ? topDet.centre.z : 0))
  const below = parts.filter(p => !keep.has(p) && p.centre.z <= (topDet ? topDet.centre.z : 0))
  parts.forEach(p => { EXIT[p.name] = 0 })
  above.forEach((p, i) => { EXIT[p.name] = 6.4 * (1 - i / Math.max(1, above.length)) + 1.6 })
  below.forEach((p, i) => { EXIT[p.name] = -(6.4 * (i + 1) / Math.max(1, below.length)) - 1.2 })
  if (detectors.length > 1) {                    // hold the layers apart so both read
    EXIT[topDet.name] = 0.42
    EXIT[botDet.name] = OPEN[botDet.name] * 0.22 - 0.42
  }

  // Ghost the top housing shells at the close so the sensors still glow through.
  parts.filter(p => p.role === 'cover' || (p.role === 'frame' && p.ordinal === 0)).forEach(p => {
    p.object.traverse(o => {
      if (!o.isMesh) return
      o.material = o.material.clone()
      ghostable.push(o.material)
    })
  })

  // Real aluminium on the shells. Runs AFTER the ghost clone above so the cover
  // gets the treatment on its own copy rather than on a material it no longer
  // uses. All four shells are one machined enclosure sharing one material in the
  // .glb, so they are done together — giving the cover metal and leaving the
  // frames as they were would only read as a mismatch in the exploded shots.
  const shellMats = new Set()
  parts.filter(p => SHELL_ROLES.includes(p.role)).forEach(p => p.object.traverse(o => {
    if (!o.isMesh || !o.material) return
    for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
      if (m.metalness !== undefined) shellMats.add(m)      // MeshStandard/Physical only
    }
  }))
  shellMats.forEach(m => {
    m.color.setHex(ALUMINIUM.color)
    m.metalness = ALUMINIUM.metalness
    m.roughness = ALUMINIUM.roughness
    m.envMap = HOUSING_ENV                                 // overrides scene.environment
    m.envMapIntensity = ALUMINIUM.env * LIGHT_LEVEL.v
    m.needsUpdate = true
    housingMats.push(m)
  })
  console.log('FILM housing: aluminium on ' + shellMats.size + ' material(s) across ' +
    parts.filter(p => SHELL_ROLES.includes(p.role)).map(p => p.name).join(', '))

  // Dimension caption, measured from the housing shells (not the connector
  // overhang) so it stays true for any revision.
  const shellBox = new Box3()
  parts.filter(p => ['cover', 'frame', 'base'].includes(p.role)).forEach(p => shellBox.union(p.restBox))
  if (!shellBox.isEmpty()) {
    const s = shellBox.getSize(new Vector3())
    const fmt = v => (Math.round(v * mmPerUnit * 10) / 10).toFixed(1).replace(/\.0$/, '')
    housingCaption = fmt(s.x) + ' × ' + fmt(s.y) + ' × ' + fmt(s.z) + ' mm'
  }

  if (moonTex) {
    moonTex.colorSpace = 'srgb'
    moonTex.wrapS = moonTex.wrapT = RepeatWrapping
    const g = new SphereGeometry(1000, 48, 48)
    g.scale(-1, 1, 1)
    sky = new Mesh(g, new MeshBasicMaterial({ map: moonTex, color: 0x0a0a0a, toneMapped: false }))
    sky.rotation.x = Math.PI / 2
    scene.add(sky)
  }

  // Sensors, found by shape. The film paints data onto them, so a wrong guess
  // here is the most visible failure there is — the boot log names what it found.
  detectors.forEach((det, i) => {
    const found = findSensor(det, mmPerUnit)
    if (!found) { console.warn('FILM no sensor die found in ' + det.name); return }
    console.log('FILM sensor[' + i + '] ' + det.name + ' -> ' + found.name + ' ' +
      found.widthMm.toFixed(2) + '×' + found.heightMm.toFixed(2) + '×' + found.thicknessMm.toFixed(2) + 'mm')
    const screen = makeScreen()
    const w = Math.min(found.size.x, found.activeUnits * 1.02)
    const h = Math.min(found.size.y, found.activeUnits * 1.02)
    const crispMat = new MeshBasicMaterial({
      map: new CanvasTexture(screen.crisp), transparent: true, blending: ADDITIVE,
      depthWrite: false, toneMapped: false, side: DOUBLE_SIDE,
    })
    crispMat.map.magFilter = NEAREST
    crispMat.map.minFilter = LINEAR
    crispMat.map.generateMipmaps = false
    const crispMesh = new Mesh(new PlaneGeometry(w, h), crispMat)
    crispMesh.position.set(found.centre.x, found.centre.y, found.topZ + 0.004)

    const glowMat = new MeshBasicMaterial({
      map: new CanvasTexture(screen.glow), transparent: true, blending: ADDITIVE,
      depthWrite: false, toneMapped: false, side: DOUBLE_SIDE, opacity: 0.5,
    })
    glowMat.map.generateMipmaps = false
    const glowMesh = new Mesh(new PlaneGeometry(w * 1.12, h * 1.12), glowMat)
    glowMesh.position.set(found.centre.x, found.centre.y, found.topZ + 0.003)

    det.wrap.add(crispMesh); det.wrap.add(glowMesh)   // ride the explode
    screen.planes = { crisp: crispMesh, glow: glowMesh }
    screen.sensor = found
    screens.push(screen)
    sensors.push({ det, found })
  })

  controls = new OrbitControls(camera, canvas)
  controls.enableDamping = true
  controls.dampingFactor = 0.06
  controls.enablePan = false
  controls.enabled = false
  controls.target.set(0, 0, 0)

  parts.forEach(p => {
    const el = document.createElement('div')
    el.className = 'label'
    el.innerHTML = '<span class="rule"></span><span class="stack"><span class="txt">' + p.label +
      '</span>' + (p.detail ? '<span class="det">' + p.detail + '</span>' : '') + '</span>'
    ui.labels.appendChild(el)
    labelEls.push({ el, part: p })
  })
}

// ---------------------------------------------------------------- camera rig
// Shots are framing INTENTS — what to look at, from which angle, filling how
// much of the frame — resolved against the measured model at build time.
const CAM = { az: 0, el: 0, r: 6, tx: 0, ty: 0, tz: 0 }
function applyCamera() {
  const ce = Math.cos(CAM.el), se = Math.sin(CAM.el)
  camera.position.set(
    CAM.tx + CAM.r * ce * Math.cos(CAM.az),
    CAM.ty + CAM.r * ce * Math.sin(CAM.az),
    CAM.tz + CAM.r * se)
  camera.lookAt(CAM.tx, CAM.ty, CAM.tz)
}

function offsetsFor(state) {
  if (state === 'open') return OPEN
  if (state === 'exit') return EXIT
  return null                                   // closed
}
/** Box of the aimed subject, with the given state's explode offsets applied. */
function aimBox(aim, state) {
  const off = offsetsFor(state)
  const box = new Box3()
  const add = p => {
    const b = p.restBox.clone()
    const dz = off ? (off[p.name] || 0) : 0
    b.min.z += dz; b.max.z += dz
    box.union(b)
  }
  if (aim === 'all') parts.forEach(add)
  else if (aim === 'detectors') detectors.forEach(add)
  else if (aim.startsWith('sensor:')) {
    const i = +aim.split(':')[1]
    const s = sensors[Math.min(i, sensors.length - 1)]
    if (!s) { parts.forEach(add); return box }
    const b = s.found.box.clone()
    const dz = off ? (off[s.det.name] || 0) : 0
    b.min.z += dz; b.max.z += dz
    box.union(b)
  } else if (aim.startsWith('role:')) {
    const role = aim.split(':')[1]
    parts.filter(p => p.role === role).forEach(add)
  } else parts.forEach(add)
  return box
}

const SHOTS = [
  { t: 0.0, d: 4.0, aim: 'all', state: 'closed', az: 35, el: 26, fill: 0.34, ease: 'power1.out' },
  { t: 4.0, d: 7.0, aim: 'all', state: 'closed', az: 35, el: 26, fill: 0.78, ease: 'power3.inOut' },
  { t: 11.0, d: 5.0, aim: 'all', state: 'closed', az: -90, el: 3, fill: 0.86, ease: 'power2.inOut', bulge: 1.14 },
  { t: 16.0, d: 7.0, aim: 'all', state: 'open', az: -90, el: 4, fill: 0.68, ease: 'power2.inOut' },
  { t: 23.0, d: 6.0, aim: 'detectors', state: 'exit', az: -58, el: 34, fill: 0.62, ease: 'power2.inOut' },
  { t: 29.0, d: 6.0, aim: 'sensor:0', state: 'exit', az: -68, el: 52, fill: 0.72, ease: 'power2.inOut' },
  { t: 35.0, d: 7.0, aim: 'sensor:0', state: 'exit', az: -68, el: 54, fill: 0.80, ease: 'none' },
  { t: 42.0, d: 8.0, aim: 'detectors', state: 'exit', az: -66, el: 44, fill: 0.74, ease: 'power1.inOut' },
  { t: 50.0, d: 7.0, aim: 'all', state: 'closed', az: -36, el: 30, fill: 0.72, ease: 'power2.inOut' },
  { t: 57.0, d: 7.0, aim: 'all', state: 'closed', az: -36, el: 30, fill: 0.46, ease: 'power1.out' },
]
function solveShot(sh) {
  const box = aimBox(sh.aim, sh.state)
  const centre = box.getCenter(new Vector3())
  const dir = dirFrom(sh.az, sh.el)
  const aspect = window.innerWidth / window.innerHeight
  const r = fitBox(box, dir, 50, aspect, sh.fill)
  return { az: (sh.az * Math.PI) / 180, el: (sh.el * Math.PI) / 180, r, t: centre }
}

/**
 * For each shot, how much of the frame the aimed subject actually occupies once
 * projected — catches a mis-framed shot without needing to look at a render.
 */
function reportShots() {
  const lines = []
  const saved = { ...CAM }
  SHOTS.forEach((sh, i) => {
    const s = solveShot(sh)
    CAM.az = s.az; CAM.el = s.el; CAM.r = s.r; CAM.tx = s.t.x; CAM.ty = s.t.y; CAM.tz = s.t.z
    applyCamera()
    camera.updateMatrixWorld(true)
    const box = aimBox(sh.aim, sh.state)
    let x0 = 9, x1 = -9, y0 = 9, y1 = -9, behind = 0
    const c = new Vector3()
    for (const p of [[box.min.x, box.min.y, box.min.z], [box.max.x, box.min.y, box.min.z],
                     [box.min.x, box.max.y, box.min.z], [box.max.x, box.max.y, box.min.z],
                     [box.min.x, box.min.y, box.max.z], [box.max.x, box.min.y, box.max.z],
                     [box.min.x, box.max.y, box.max.z], [box.max.x, box.max.y, box.max.z]]) {
      c.set(p[0], p[1], p[2]).project(camera)
      if (c.z > 1) behind++
      x0 = Math.min(x0, c.x); x1 = Math.max(x1, c.x)
      y0 = Math.min(y0, c.y); y1 = Math.max(y1, c.y)
    }
    lines.push('  shot' + i + ' t=' + sh.t + ' aim=' + sh.aim + '/' + sh.state +
      ' r=' + s.r.toFixed(2) +
      ' fillX=' + ((x1 - x0) / 2).toFixed(2) + ' fillY=' + ((y1 - y0) / 2).toFixed(2) +
      ' want=' + sh.fill + (behind ? ' BEHIND=' + behind : '') +
      ((x1 > 1.02 || x0 < -1.02 || y1 > 1.02 || y0 < -1.02) ? ' CLIPPED' : ''))
  })
  Object.assign(CAM, saved)
  applyCamera()
  return lines.join('\n')
}

// ---------------------------------------------------------------- captions
// Discrete state is DERIVED from the playhead every frame, never fired by
// one-shot callbacks: GSAP suppresses callbacks on a backwards seek, which
// previously left parts hidden and stale captions after scrubbing.
let CAPTIONS = []
function buildCaptions() {
  const two = detectors.length > 1
  CAPTIONS = [
    { t: 1.6, until: 4.2, main: 'HardPix' },
    { t: 5.4, until: 10.6, main: 'A radiation spectrometer', sub: 'Institute of Experimental and Applied Physics · Czech Technical University in Prague' },
    { t: 12.4, until: 15.6, main: housingCaption ? 'Dimensions — ' + housingCaption : '', sub: 'as modelled' },
    { t: 17.4, until: 22.8, main: two ? 'Two detector layers' : 'One detector layer', top: true, sub: 'modular design · one or two detector layers · custom communication interface' },
    { t: 24.8, until: 28.4, main: two ? 'Two Timepix2' : 'One Timepix2', sub: 'sensitive area 2 cm² · variable sensor types (Si, CdTe, …)' },
    { t: 30.4, until: 34.4, main: '256 × 256 pixels — 55 micrometres each', sub: 'every pixel measures the energy a particle left in it' },
    { t: 36.4, until: 41.9, main: 'One particle. One track.' },
    { t: 43.4, until: 49.0, main: 'Visualisation of measurement' },
    { t: 57.6, until: 63.8, main: 'The first HardPix launched 12 June 2023', sub: 'Falcon 9 · a D-Orbit ION spacecraft · UKRI SWIMMR-1' },
  ].filter(c => c.main)
}
const HIDE_FROM = 28.6, HIDE_TO = 49.6      // only the detector layers are on screen
const LABELS_FROM = 17.6, LABELS_TO = 22.8

function showLine(el, text) {
  if (!text) { el.classList.remove('in'); return }
  if (el.textContent === text && el.classList.contains('in')) return
  el.textContent = text
  el.classList.remove('in')
  void el.offsetWidth
  el.classList.add('in')
}
let activeCap = -2
function syncCaptions(t) {
  let idx = -1
  for (let i = 0; i < CAPTIONS.length; i++) if (t >= CAPTIONS[i].t && t < CAPTIONS[i].until) idx = i
  if (idx === activeCap) return
  activeCap = idx
  const c = idx >= 0 ? CAPTIONS[idx] : null
  ui.capWrap.classList.toggle('top', !!(c && c.top))
  showLine(ui.capMain, c && c.main)
  showLine(ui.capSub, c && c.sub)
}
let lastVis = null
function setHeavyVisible(show) {
  parts.forEach(p => { if (p.role !== 'detector') p.wrap.visible = show })
}
function syncVisibility(t) {
  const show = !(t >= HIDE_FROM && t < HIDE_TO)
  if (show === lastVis) return
  lastVis = show
  setHeavyVisible(show)
}
let lastLabels = null
function setLabels(on) {
  ui.labels.classList.toggle('on', on)
  labelEls.forEach((l, i) => {
    l.el.style.transitionDelay = on ? (i * 0.09) + 's' : '0s'
    l.el.classList.toggle('in', on)
  })
}
function syncLabels(t) {
  const on = t >= LABELS_FROM && t < LABELS_TO
  if (on === lastLabels) return
  lastLabels = on
  setLabels(on)
}
// A seek breaks the accumulating detector canvases, so rebuild for the beat we
// landed in.
function resyncData(t) {
  screens.forEach(s => s.clear())
  hero.shown = 0
  const upper = screens[0], lower = screens[1]
  if (!upper) return
  if (t < 42) {
    screens.forEach(s => { s.rate = 0; s.persist = 0.985 })
    upper.playhead = QUIET_FRAME; upper.drawn = QUIET_FRAME - 1
  } else if (t < 50) {
    const f = Math.max(0, (t - 42) / 8)
    screens.forEach(s => { s.persist = 0.93 })
    upper.playhead = STORM_IN + f * (STORM_PEAK - STORM_IN)
    upper.drawn = Math.floor(upper.playhead) - 1
    if (lower) { lower.playhead = upper.playhead + LOWER_OFFSET; lower.drawn = Math.floor(lower.playhead) - 1 }
  } else {
    screens.forEach(s => { s.persist = 0.975 })
    upper.playhead = QUIET_FRAME + (t - 50); upper.drawn = Math.floor(upper.playhead) - 1
    if (lower) { lower.playhead = QUIET_FRAME + LOWER_OFFSET + (t - 50); lower.drawn = Math.floor(lower.playhead) - 1 }
  }
}
let lastSyncTime = 0
function syncFilmState() {
  if (!master) return
  const t = master.time()
  if (Math.abs(t - lastSyncTime) > 0.4) resyncData(t)
  lastSyncTime = t
  syncCaptions(t)
  syncVisibility(t)
  syncLabels(t)
}

// ---------------------------------------------------------------- timeline
let master = null
function buildTimeline() {
  const tl = gsap.timeline({ paused: true, onUpdate: onTimelineTick, onComplete: onFilmEnd })

  const solved = SHOTS.map(solveShot)
  CAM.az = solved[0].az; CAM.el = solved[0].el; CAM.r = solved[0].r
  CAM.tx = solved[0].t.x; CAM.ty = solved[0].t.y; CAM.tz = solved[0].t.z
  let prevAz = solved[0].az
  SHOTS.forEach((sh, i) => {
    if (i === 0) return
    const s = solved[i]
    let az = s.az
    while (az - prevAz > Math.PI) az -= 2 * Math.PI
    while (az - prevAz < -Math.PI) az += 2 * Math.PI
    prevAz = az
    tl.to(CAM, { az, el: s.el, tx: s.t.x, ty: s.t.y, tz: s.t.z, duration: sh.d, ease: sh.ease }, sh.t)
    if (sh.bulge) {
      // swing the radius out through the middle of an orbit so the camera never
      // grazes the object it is travelling around
      tl.to(CAM, { r: s.r * sh.bulge, duration: sh.d * 0.5, ease: 'power1.out' }, sh.t)
        .to(CAM, { r: s.r, duration: sh.d * 0.5, ease: 'power1.in' }, sh.t + sh.d * 0.5)
    } else {
      tl.to(CAM, { r: s.r, duration: sh.d, ease: sh.ease }, sh.t)
    }
  })
  tl.fromTo(CAM, { r: solved[0].r * 1.18 }, { r: solved[0].r, duration: SHOTS[0].d, ease: 'power1.out' }, 0)

  // shot 1 — build out of black
  tl.to(LIGHT_LEVEL, { v: 1, duration: 3.4, ease: 'power2.out', onUpdate: applyLights }, 0.3)
  if (sky) tl.fromTo(sky.material.color, { r: 0, g: 0, b: 0 },
    { r: 0.052, g: 0.052, b: 0.052, duration: 4.5, ease: 'power1.out' }, 0.6)

  // explode / isolate / reassemble
  parts.forEach((p, i) => {
    tl.to(p.wrap.position, { z: OPEN[p.name], duration: 6.4, ease: 'power2.inOut' }, 16.3)
    tl.to(p.wrap.position, { z: EXIT[p.name], duration: 4.0, ease: 'power1.in' }, 23.3)
    tl.to(p.wrap.position, { z: 0, duration: 5.2, ease: 'power2.inOut' }, 50.2 + i * 0.09)
  })

  // the data beats are lit by the data: the rig falls away for the macro third
  tl.to(LIGHT_LEVEL, { v: 0.30, duration: 2.2, ease: 'power2.inOut', onUpdate: applyLights }, 33.6)
  tl.to(LIGHT_LEVEL, { v: 1, duration: 2.4, ease: 'power2.inOut', onUpdate: applyLights }, 49.4)

  // ---- data
  tl.call(() => { resyncData(35) }, null, 34.8)
  tl.to(hero, { progress: 1, duration: 2.6, ease: 'power1.inOut' }, 35.6)   // the track draws itself
  tl.call(() => { resyncData(42) }, null, 42.0)
  screens.forEach((s, i) => {
    tl.to(s, { rate: 900, duration: 3.0, ease: 'power2.in' }, 42.1 + i * 0.15)
    tl.to(s, { rate: 260, duration: 3.4, ease: 'power2.out' }, 45.4)
    tl.to(s, { rate: 0, duration: 1.2, ease: 'power1.out' }, 48.8)
  })
  tl.call(() => { resyncData(50.2) }, null, 50.2)
  screens.forEach(s => tl.to(s, { rate: 1, duration: 0.1 }, 50.3))          // 1x real time

  // close — the sensors stay alive behind the ghosted shells; past d~2 a single
  // hit is sub-pixel, so the glow quads scale up. The film's one exaggeration.
  screens.forEach(s => {
    if (!s.planes) return
    tl.to(s.planes.glow.scale, { x: 3.4, y: 3.4, duration: 9.0, ease: 'power1.inOut' }, 50.5)
    tl.to(s.planes.glow.material, { opacity: 0.95, duration: 9.0, ease: 'power1.inOut' }, 50.5)
  })
  tl.call(() => ghostable.forEach(m => { m.transparent = true; m.depthWrite = false }), null, 57.0)
  ghostable.forEach(m => tl.to(m, { opacity: 0.12, duration: 1.6, ease: 'power2.inOut' }, 57.2))

  tl.set({}, {}, 64)
  return tl
}

// ---------------------------------------------------------------- labels
const _v = new Vector3(), _c = new Vector3()
function positionLabels() {
  if (!ui.labels.classList.contains('on')) return
  const w = window.innerWidth, h = window.innerHeight
  labelEls.forEach(l => {
    const p = l.part
    _v.copy(p.centre); _v.z += p.wrap.position.z
    _v.project(camera)
    const y = (-_v.y * 0.5 + 0.5) * h
    let right = -Infinity
    for (const c of p.corners) {
      _c.copy(c); _c.z += p.wrap.position.z; _c.project(camera)
      const cx = (_c.x * 0.5 + 0.5) * w
      if (cx > right) right = cx
    }
    const x = Math.min(w - 220, Math.max((_v.x * 0.5 + 0.5) * w, right) + 14)
    l.el.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y - 11) + 'px)'
    l.el.style.opacity = _v.z > 1 ? 0 : ''
  })
}

// ---------------------------------------------------------------- playback ui
let ended = false
function setPaused(p) {
  ui.stage.classList.toggle('paused', p)
  ui.playpause.textContent = p ? 'Play' : 'Pause'
}
function onTimelineTick() {
  if (!master) return
  ui.played.style.width = (master.progress() * 100) + '%'
}
function onFilmEnd() {
  ended = true
  score.reset()                 // the cue has already faded out by 64s; drop the tail
  setPaused(false)
  controls.enabled = true
  controls.target.set(0, 0, 0)
  controls.update()
  ui.stage.classList.add('ended')
}
function play() {
  ended = false
  ui.stage.classList.remove('ended')
  setPaused(false)
  score.reset()
  controls.enabled = false
  screens.forEach(s => { s.clear(); s.rate = 0 })
  hero.progress = 0; hero.shown = 0
  resyncData(0)
  ghostable.forEach(m => { m.opacity = 1 })
  screens.forEach(s => {
    if (!s.planes) return
    s.planes.glow.scale.set(1, 1, 1)
    s.planes.glow.material.opacity = 0.5
  })
  setHeavyVisible(true)
  master.restart(true)
}
function togglePlay() {
  if (!master) return
  if (ended) { play(); return }
  if (master.paused()) { master.play(); setPaused(false) }
  else { master.pause(); setPaused(true) }
}

// ---------------------------------------------------------------- loop
let last = performance.now()
let stillMode = false          // ?still=1 — render one frame, then stop (review aid)
function tick(now) {
  if (!stillMode) requestAnimationFrame(tick)
  const dt = Math.min(0.05, (now - last) / 1000)
  last = now
  syncFilmState()
  if (D) {
    screens.forEach(s => s.advance(dt))
    if (hero.progress > 0 && hero.shown < heroOrdered.length) drawHeroProgress()
    screens.forEach(s => s.upload())
  }
  if (master) score.update(master.time(), !ended && !master.paused())
  syncSound()
  if (ended) controls.update()
  else applyCamera()
  positionLabels()
  renderer.render(scene, camera)
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
})

// ---------------------------------------------------------------- boot
;(async function boot() {
  applyLights()
  // The render loop deliberately does NOT start until the model is built: an
  // empty WebGL scene spinning at 60fps only steals CPU from parsing a ~90 MB
  // glTF, and the loading screen is pure CSS.
  try {
    const [gltf, moonTex, hits] = await Promise.all([loadModel(), loadMoon(), loadHits().catch(() => null)])
    build(gltf, moonTex)
    if (hits) { D = hits; buildHeroTrack() }
    buildCaptions()
    master = buildTimeline()
    applyCamera()
    renderer.render(scene, camera)                 // compile shaders before the reveal
    last = performance.now()
    tick(last)
    ui.loader.classList.add('gone')

    const params = new URLSearchParams(location.search)
    const seek = params.get('t')
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (seek !== null) {
      // ?t=12.5 freezes the film at that second, for reviewing shots
      master.pause()
      master.time(parseFloat(seek) || 0)
      lastSyncTime = -99
      syncFilmState()
      for (let i = 0; i < 90; i++) {
        screens.forEach(s => s.advance(1 / 60))
        if (hero.progress > 0) drawHeroProgress()
      }
      applyCamera()
      positionLabels()
      // ?still=1 holds this single frame (the loading screen is dropped rather
      // than faded, so a screenshot is not taken through it)
      if (params.has('still')) { stillMode = true; ui.loader.style.display = 'none' }
      renderer.render(scene, camera)
      // ?shots=1 reports where every shot actually lands — a numeric framing
      // check that does not depend on being able to look at a render
      if (params.has('shots')) console.log('FILM shots' + '\n' + reportShots())
    } else {
      // The film IS this page's content, so prefers-reduced-motion does not
      // suppress it (the same reasoning as a video player) — the transport is
      // shown up front instead so pausing is one click away.
      ui.stage.classList.add('intro')
      setTimeout(() => ui.stage.classList.remove('intro'), 3600)
      setTimeout(play, reduced ? 120 : 350)
      // Sound is wanted from the start, but no browser will start audio without
      // a gesture, so the button reads "Sound — click" until one arrives and the
      // first interaction anywhere on the page starts the cue.
      score.enable(true).then(paintSound)
    }
  } catch (err) {
    ui.pct.textContent = '—'
    ui.loader.querySelector('.status').textContent = 'Could not load: ' + err.message
    console.error(err)
  }
})()

ui.posterBtn.addEventListener('click', togglePlay)
ui.replay.addEventListener('click', play)
ui.playpause.addEventListener('click', togglePlay)
ui.sound.addEventListener('click', async () => {
  await score.enable(!score.enabled)
  score.arm()                                  // this click IS the gesture
  paintSound()
})
// Any first interaction unblocks the audio the page already asked for. Once the
// viewer has used the Sound button themselves, score.enabled carries their
// choice and arm() respects it.
;['pointerdown', 'keydown'].forEach(ev => window.addEventListener(ev, () => {
  score.arm()
  paintSound()
  setTimeout(paintSound, 150)      // ctx.resume() settles a beat after the gesture
}, { passive: true }))
ui.scrub.addEventListener('click', e => {
  if (!master) return
  const r = ui.scrub.getBoundingClientRect()
  master.pause()
  master.progress(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)))
  ended = false
  ui.stage.classList.remove('ended')
  controls.enabled = false
  syncFilmState()
  master.play()
  setPaused(false)
})
document.addEventListener('visibilitychange', () => {
  if (!master || ended) return
  if (document.hidden && !master.paused()) { master.pause(); setPaused(true); wasAutoPaused = true }
  else if (!document.hidden && wasAutoPaused) { wasAutoPaused = false; master.play(); setPaused(false) }
})
let wasAutoPaused = false
window.addEventListener('keydown', e => {
  if (!master) return
  if (e.code === 'Space') { e.preventDefault(); togglePlay() }
  if (e.code === 'KeyR') play()
})
