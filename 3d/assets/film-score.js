// HardPix2 — "Fourteen Millimetres": the score.
//
// The brief was Hans Zimmer's Interstellar main theme. That recording is
// licensed material this repo cannot ship, so the page SYNTHESISES an original
// cue in the same idiom — a tonic pedal, hymnal pipe-organ chords, a rising
// sixteenth-note ostinato and one long build — written against the film's own
// beat sheet so the swells land ON the cuts instead of near them. No audio
// bytes are downloaded; the whole cue is Web Audio nodes.
//
// If you hold a licence for a real track, point SCORE_FILE (film.js) or
// ?score=./assets/theme.mp3 at it. The file then plays instead of the synth and
// is held in sync with the timeline through every pause, scrub and replay, so
// the same beat sheet still applies — only the source changes.
//
// Everything is driven from the film's playhead, never from wall-clock time: a
// scrub is a seek, and a seek re-cues the organ rather than letting the music
// drift a few bars behind the picture.

const LOOKAHEAD = 0.35        // seconds of music scheduled ahead of the playhead
const SEEK_EPS = 0.35         // a playhead jump larger than this is a seek, not a frame

const BPM = 96
const SIXTEENTH = 60 / BPM / 4

const hz = m => 440 * Math.pow(2, (m - 69) / 12)

// A minor. `pad` is the organ voicing, `bass` the root an octave down, `arp` the
// four-note cell the ostinato climbs.
const CHORDS = {
  Am: { pad: [45, 52, 57, 60, 64], bass: 33, arp: [57, 60, 64, 69] },
  F:  { pad: [41, 53, 57, 60, 65], bass: 29, arp: [53, 57, 60, 65] },
  C:  { pad: [48, 55, 60, 64, 67], bass: 36, arp: [55, 60, 64, 67] },
  G:  { pad: [43, 55, 59, 62, 67], bass: 31, arp: [55, 59, 62, 67] },
  Dm: { pad: [50, 57, 62, 65, 69], bass: 38, arp: [50, 57, 62, 65] },
}

// [film time, chord, dynamic 0..1, ostinato 0..1] — one row per beat of the
// film. The times ARE the cut points in film.js (SHOTS / CAPTIONS), so moving a
// shot means moving the matching row here and nothing else.
const SECTIONS = [
  [ 0.0, 'Am', 0.00, 0.00],   // black
  [ 1.4, 'Am', 0.22, 0.00],   // "HardPix" — the organ breathes in
  [ 5.4, 'F',  0.34, 0.30],   // the push in — "A radiation spectrometer"
  [11.0, 'C',  0.38, 0.42],   // the orbit
  [16.3, 'G',  0.50, 0.58],   // the stack opens
  [19.8, 'Am', 0.54, 0.62],
  [23.3, 'F',  0.40, 0.34],   // everything but the two layers leaves frame
  [29.0, 'C',  0.34, 0.26],   // in to one sensor
  [34.6, 'Am', 0.22, 0.00],   // the hush — one particle draws its own track
  [39.4, 'Dm', 0.26, 0.12],
  [42.0, 'Am', 0.44, 0.62],   // the storm starts climbing
  [44.4, 'F',  0.56, 0.74],
  [46.6, 'C',  0.68, 0.86],
  [48.8, 'G',  0.80, 0.96],
  [50.4, 'Am', 0.92, 1.00],   // peak — the instrument reassembles
  [53.2, 'F',  0.94, 0.92],
  [55.6, 'C',  0.86, 0.72],
  [57.6, 'F',  0.66, 0.42],   // "The first HardPix launched 12 June 2023"
  [60.6, 'C',  0.48, 0.24],
  [62.6, 'C',  0.20, 0.00],
  [64.0, 'C',  0.00, 0.00],
]

const smooth = x => x * x * (3 - 2 * x)
function indexAt(t) {
  let i = 0
  while (i < SECTIONS.length - 1 && SECTIONS[i + 1][0] <= t) i++
  return i
}
/** Dynamic and ostinato level at a film time, eased across the section joins. */
function levelsAt(t) {
  const i = indexAt(t)
  const a = SECTIONS[i], b = SECTIONS[Math.min(i + 1, SECTIONS.length - 1)]
  const span = Math.max(1e-3, b[0] - a[0])
  const f = smooth(Math.max(0, Math.min(1, (t - a[0]) / span)))
  return { level: a[2] + (b[2] - a[2]) * f, arp: a[3] + (b[3] - a[3]) * f }
}

/** A cathedral tail, generated rather than downloaded. */
function impulse(ctx, seconds = 3.4, decay = 2.4) {
  const rate = ctx.sampleRate
  const len = Math.max(1, Math.floor(rate * seconds))
  const buf = ctx.createBuffer(2, len, rate)
  const attack = rate * 0.012
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch)
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay) * Math.min(1, i / attack)
    }
  }
  return buf
}

// Drawbars. A pipe organ is the fundamental plus its octave, twelfth and double
// octave; the sixth and eighth partials are what survive a laptop speaker.
const DRAWBARS = [[1, 1.0], [2, 0.52], [3, 0.24], [4, 0.17], [6, 0.08], [8, 0.055]]

export function createScore({ file = '', volume = 0.55, offset = 0 } = {}) {
  let ctx = null, master = null, dry = null, wet = null, send = null, comp = null
  let bus = null                 // current voice generation — a seek swaps it out
  let droneGain = null
  let el = null                  // <audio>, when a licensed file is supplied
  let mode = file ? 'file' : 'synth'
  let vol = volume

  let wanted = false             // what the viewer asked for
  let running = false            // the scheduler is cued and following the playhead
  let secIdx = 0, arpIdx = 0, lastT = -99

  function ensure() {
    if (ctx || mode !== 'synth') return
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) { mode = 'none'; return }
    ctx = new AC()
    comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -14; comp.ratio.value = 4
    comp.attack.value = 0.006; comp.release.value = 0.28
    master = ctx.createGain(); master.gain.value = vol
    dry = ctx.createGain(); dry.gain.value = 0.82
    wet = ctx.createGain(); wet.gain.value = 0.85
    const verb = ctx.createConvolver(); verb.buffer = impulse(ctx)
    send = ctx.createGain(); send.gain.value = 0.42
    send.connect(verb); verb.connect(wet)
    dry.connect(master); wet.connect(master)
    master.connect(comp); comp.connect(ctx.destination)
    newBus()
    // The tonic pedal runs for the life of the page; only its gain moves.
    droneGain = ctx.createGain(); droneGain.gain.value = 0.0001
    droneGain.connect(dry); droneGain.connect(send)
    const PEDAL = [[33, 0.9, 0], [45, 0.5, 5], [57, 0.13, -4]]
    for (const [m, amp, cents] of PEDAL) {
      const o = ctx.createOscillator()
      o.type = 'sine'
      o.frequency.value = hz(m) * Math.pow(2, cents / 1200)
      const g = ctx.createGain(); g.gain.value = amp
      o.connect(g); g.connect(droneGain)
      o.start()
    }
  }

  function ensureFile() {
    if (el || mode !== 'file') return
    el = new Audio(file)
    el.preload = 'auto'
    el.volume = 0
    el.addEventListener('error', () => {
      // A missing or unplayable track must not leave the film silent.
      console.warn('FILM score: could not load ' + file + ' — using the synth cue')
      el = null
      mode = 'synth'
      if (wanted) { ensure(); if (ctx) ctx.resume().catch(() => {}) }
    })
  }

  /** A fresh voice generation, so a seek can mute everything already scheduled. */
  function newBus() {
    bus = ctx.createGain()
    bus.gain.value = 1
    bus.connect(dry); bus.connect(send)
  }
  function panic() {
    if (!ctx || !bus) return
    const old = bus
    old.gain.cancelScheduledValues(ctx.currentTime)
    old.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.015)
    setTimeout(() => { try { old.disconnect() } catch (e) {} }, 400)
    newBus()
    running = false
  }

  function organ(midi, at, dur, gain) {
    const g = ctx.createGain()
    const peak = Math.max(0.0002, gain)
    g.gain.setValueAtTime(0.0001, at)
    g.gain.exponentialRampToValueAtTime(peak, at + 0.85)   // slow wind, like a rank speaking
    g.gain.setValueAtTime(peak, at + dur)
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur + 1.7)
    g.connect(bus)
    const f = hz(midi)
    for (const [mult, amp] of DRAWBARS) {
      const o = ctx.createOscillator()
      o.type = 'sine'
      // ranks are never perfectly in tune with each other; a few cents of spread
      // is what keeps the chord from sounding like an additive synth
      o.frequency.value = f * mult * Math.pow(2, ((Math.random() - 0.5) * 10) / 1200)
      const pg = ctx.createGain(); pg.gain.value = amp
      o.connect(pg); pg.connect(g)
      o.start(at); o.stop(at + dur + 1.9)
    }
  }

  function pluck(midi, at, gain) {
    const f = hz(midi)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, at)
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), at + 0.010)
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.62)
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'; lp.Q.value = 0.7
    lp.frequency.setValueAtTime(f * 8, at)
    lp.frequency.exponentialRampToValueAtTime(f * 2.1, at + 0.34)
    lp.connect(g); g.connect(bus)
    const a = ctx.createOscillator(); a.type = 'triangle'; a.frequency.value = f
    const b = ctx.createOscillator(); b.type = 'sine'; b.frequency.value = f * 2.005
    const bg = ctx.createGain(); bg.gain.value = 0.3
    a.connect(lp); b.connect(bg); bg.connect(lp)
    a.start(at); a.stop(at + 0.7)
    b.start(at); b.stop(at + 0.7)
  }

  function chordAt(t, at, dur, level) {
    const ch = CHORDS[SECTIONS[indexAt(t)][1]]
    ch.pad.forEach((m, i) => organ(m, at, dur, level * (i === 0 ? 0.09 : 0.062)))
    organ(ch.bass, at, dur, level * 0.10)
  }

  /** Re-cue at a film time: silence what is in flight, then speak the chord we
   *  landed inside, so a scrub never drops into an empty bar. */
  function cue(t) {
    panic()
    secIdx = 0
    while (secIdx < SECTIONS.length && SECTIONS[secIdx][0] <= t) secIdx++
    arpIdx = Math.max(0, Math.ceil(t / SIXTEENTH))
    const lv = levelsAt(t)
    if (lv.level > 0.02 && t < 64) {
      const next = SECTIONS[Math.min(secIdx, SECTIONS.length - 1)][0]
      chordAt(t, ctx.currentTime + 0.02, Math.max(0.6, next - t), lv.level)
    }
    running = true
  }

  function scheduleSynth(t) {
    const now = ctx.currentTime
    const horizon = t + LOOKAHEAD
    const at = ft => Math.max(now, now + (ft - t))

    while (secIdx < SECTIONS.length && SECTIONS[secIdx][0] < horizon) {
      const s = SECTIONS[secIdx]
      const next = SECTIONS[Math.min(secIdx + 1, SECTIONS.length - 1)][0]
      const lv = levelsAt(s[0] + 0.001)
      if (lv.level > 0.02) chordAt(s[0] + 0.001, at(s[0]), Math.max(0.6, next - s[0]), lv.level)
      secIdx++
    }

    while (arpIdx * SIXTEENTH < horizon) {
      const ft = arpIdx * SIXTEENTH
      if (ft >= 64) break
      const lv = levelsAt(ft)
      // Density IS the dynamic: quarters, then eighths, then sixteenths, plus an
      // octave doubling once the storm is on top of the picture.
      let step = 0
      if (lv.arp >= 0.62) step = 1
      else if (lv.arp >= 0.34) step = 2
      else if (lv.arp >= 0.10) step = 4
      if (step && arpIdx % step === 0) {
        const cell = CHORDS[SECTIONS[indexAt(ft)][1]].arp
        const k = Math.floor(arpIdx / step)
        const midi = cell[k % cell.length] + (Math.floor(k / cell.length) % 2 ? 12 : 0)
        const accent = arpIdx % 4 === 0 ? 1.0 : 0.66
        const g = lv.arp * lv.level * 0.13 * accent
        pluck(midi, at(ft), g)
        if (lv.arp > 0.78) pluck(midi + 12, at(ft), g * 0.34)
      }
      arpIdx++
    }

    droneGain.gain.setTargetAtTime(Math.max(0.0001, levelsAt(t).level * 0.11), now, 0.3)
  }

  /** Head and tail fade, so a licensed track neither starts nor stops on a click. */
  function envelope(t) {
    if (t < 1.2) return Math.max(0, t / 1.2)
    if (t > 62.4) return Math.max(0, (64 - t) / 1.6)
    return 1
  }

  return {
    get source() { return mode },
    get enabled() { return wanted },
    /** True when the viewer asked for sound but the browser has not let it start. */
    get blocked() { return wanted && mode === 'synth' && !!ctx && ctx.state !== 'running' },

    /** Turn the score on or off. Resolves to whether audio is actually running. */
    async enable(on) {
      wanted = on
      if (!on) {
        if (el) el.pause()
        if (ctx) { panic(); droneGain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.05) }
        return false
      }
      if (mode === 'file') { ensureFile(); return !!el }
      ensure()
      if (!ctx) return false
      try { await ctx.resume() } catch (e) { /* needs a gesture; arm() retries */ }
      return ctx.state === 'running'
    },

    /** Call from any user gesture — browsers only start audio from one. */
    arm() {
      if (!wanted) return
      if (mode === 'file') { ensureFile(); return }
      ensure()
      if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {})
    },

    /** Called every frame with the film's own playhead. */
    update(t, playing) {
      if (!wanted) return
      if (mode === 'file') {
        if (!el) return
        if (!playing) { if (!el.paused) el.pause(); lastT = t; return }
        // A track is almost never the length of the film, so `offset` chooses
        // WHICH stretch of it plays under the picture: film second 0 is track
        // second `offset`. The fade below stays keyed to film time either way.
        const trackT = t + offset
        if (Math.abs(el.currentTime - trackT) > 0.25) { try { el.currentTime = trackT } catch (e) {} }
        el.volume = vol * envelope(t)
        if (el.paused) el.play().catch(() => {})
        lastT = t
        return
      }
      if (!ctx || ctx.state !== 'running') return
      if (!playing) { if (running) panic(); lastT = t; return }
      if (!running || Math.abs(t - lastT) > SEEK_EPS) cue(t)
      lastT = t
      scheduleSynth(t)
    },

    /** The film restarted or ended — drop everything still in flight. */
    reset() {
      if (el) { el.pause(); try { el.currentTime = offset } catch (e) {} }
      if (ctx) panic()
      lastT = -99
    },

    setVolume(v) {
      vol = v
      if (master) master.gain.setTargetAtTime(v, ctx.currentTime, 0.05)
      if (el) el.volume = v
    },
  }
}
