# /3d — HardPix pages

Standalone WebGL pages, outside the Publii-generated site, reached through their
own index:

| Page | What it is | Model |
|---|---|---|
| `index.html` | **Entry point.** Links the three below. Static and instant — it deliberately loads no model | — |
| `film.html` | **The product film.** 64 s, plays once, then hands the model to the viewer | `HardPix2_TPX2.glb` |
| `hardpix.html` | Scroll-driven exploded view (older, see *Known bugs*) | `HardPix_SWIMMR.glb` |
| `assembly.html` | Scroll-driven exploded view of an earlier assembly | `t2m_assembly.glb` |

Live at `https://pahoclock.com/3d/` (GitHub Pages serves the repo root).

`assembly.html` **was** `index.html` until the index became a landing page. Nothing
on the wider site links here — pahoclock.com is the word-clock site, and these
pages are a separate project sharing the repo — so `/3d/` is the only way in, and
a link added here is the only thing that makes a page reachable.

---

## Running it locally

These pages **cannot be opened by double-clicking**. They are ES modules, which
browsers refuse to load over `file://`, and they fetch the model over HTTP.

```sh
cd 3d
python -m http.server 8000
# then open http://localhost:8000/film.html
```

Serving from the repo root instead works too — the URL just gains the prefix:
`http://localhost:8000/3d/film.html`. Asset paths are relative, so both work.

### Review URLs

| URL | Effect |
|---|---|
| `film.html?t=21` | Freeze the film at t = 21 s |
| `film.html?t=21&still=1` | Freeze *and* stop the render loop — one frame, for screenshots |
| `film.html?t=0&shots=1` | Print every shot's solved camera and how much of the frame it fills |
| `film.html?score=./music/x.mp3` | Audition an audio file in place of the synthesised cue |
| `film.html?score-at=45` | Start that file 45 s in — which stretch plays under the picture |

**`&still=1` does not screenshot in headless Chrome.** It stops the render loop
after one frame, and the compositor never samples the WebGL canvas, so the
capture comes back as an empty scene with the captions drawn over it — which
looks exactly like a model that failed to load. Drop `still=1` and screenshot
`?t=21` alone: the loop keeps rendering and the canvas composites. Headless also
needs `--use-angle=swiftshader --enable-unsafe-swiftshader`, and *not*
`--disable-gpu`, which kills the canvas outright.

`&shots=1` is the fastest way to check framing after changing a model or a shot,
and it needs no eyeballing:

```
shot3 t=16 aim=all/open r=9.00 fillX=0.25 fillY=0.68 want=0.68
```
Flags `CLIPPED` or `BEHIND` if a shot would cut the subject or put it behind the
camera.

---

## Swapping in a new model

This is the main thing the film was built to survive. **Change one line** in
`assets/film.js`:

```js
const MODEL_FILE = './HardPix2_TPX2.glb'
```

Then open the page with the console visible. On boot it prints exactly what it
detected — check this before anything else:

```
FILM model: ./HardPix2_TPX2.glb
#0 HARD-PIX-COVER1              role=cover       label="Cover"                 z= 0.362  86.0×41.0×5.2mm
#2 HardPix_Timepix2_TOP1        role=detector    label="Upper detector module" z= 0.210  34.1×35.0×6.3mm
...
FILM sensor[0] HardPix_Timepix2_TOP1 -> Solid82 14.08×14.14×0.01mm
```

Everything below is **measured at load**, not hard-coded:

- **Roles**, matched from name tokens (`assets/model-rig.js` → `ROLE_RULES`):
  `detector` ← timepix/tpx/detector/sensor · `comms` ← ethernet/rs422/comm/uart ·
  `processing` ← zynq/ultrascale/fpga/soc · `cover` · `base` · `frame`.
  An unmatched root gets role `unknown` and is still exploded and labelled — it
  just gets a generic name. If a new revision uses different words, add them to
  `ROLE_RULES`.
- **Stack order**, from each part's measured Z centre. Never trust the CAD names:
  in both models shipped so far `HARD-PIX-MIDDLE-TOP` sits physically *below*
  `HARD-PIX-MIDDLE-BOT`.
- **Labels**, from the role. Repeated roles are disambiguated by height, so two
  detector layers become "Upper detector module" / "Lower detector module".
- **Explode offsets**, from each part's real thickness plus a gap, so any number
  of layers of any thickness separates without collisions.
- **The dimension caption**, from the union of the housing shells — it can't go
  stale when the model changes.
- **Sensor dies**, by geometry (below).
- **Cameras**, solved per shot against the measured bounding boxes (below).

### How the sensor is found

The film paints real detector data onto the silicon, so a wrong guess here is the
most visible failure possible — and it is exactly what `hardpix.html` gets wrong:
it searches for a node called `TIMEPIX3_2LANE_DETECTOR3`, which **does not exist
in the file**, then silently falls back to the whole module's bounding box.

`findSensor()` instead looks for the shape of a Timepix die inside each detector
part: flat (< 3 mm), near-square (within 25%), 9–22 mm across, scored against the
14.08 mm active area (256 × 55 µm), preferring the topmost of the close scorers
since the die sits proud of its board. It logs what it picked and its runners-up.

Both models resolve correctly:

| Model | Die | Size |
|---|---|---|
| `HardPix2_TPX2` upper | `Solid82` | 14.080 × 14.140 × 0.010 mm |
| `HardPix2_TPX2` lower | `Solid82_1` | 14.080 × 14.140 × 0.010 mm |
| `HardPix_SWIMMR` | `Solid568_2` | 16.000 × 14.000 × 1.001 mm |

HardPix2's CAD models the *sensitive layer* as its own thin plate, so the data
plane lands exactly on the active area. The older model only has the full 16 mm
die, so the active area is inset from it.

### What to check after a swap

1. The boot log — every root has a sensible role, and a sensor was found per
   detector.
2. `?shots=1` — no `CLIPPED`, and `fill` values near their `want`.
3. `?t=21&still=1` — the exploded view, visually.
4. If the model is **not Z-up**, stop: the film assumes Z is the stacking axis
   and sets `camera.up = (0,0,1)` throughout.

---

## Editing the film

All in `assets/film.js`.

**Captions** — one array, `buildCaptions()`. Each entry is
`{ t, until, main, sub, top }`; `top` puts it at the top of frame (used while the
exploded stack fills the middle). They are *derived from the playhead every
frame*, never fired as callbacks — see the GSAP note below.

**Shots** — the `SHOTS` array. Each is a framing *intent*, not a coordinate:

```js
{ t: 23.0, d: 6.0, aim: 'detectors', state: 'exit', az: -58, el: 34, fill: 0.62, ease: 'power2.inOut' }
```

| Field | Meaning |
|---|---|
| `aim` | `all` · `detectors` · `sensor:0` (upper) / `sensor:1` · `role:comms` |
| `state` | `closed` · `open` (exploded) · `exit` (everything but the detectors gone) |
| `az` / `el` | Camera azimuth / elevation in degrees, Z-up |
| `fill` | Fraction of the frame the subject should span (0–1) |
| `bulge` | Optional: swing the radius out mid-move so an orbit doesn't graze the subject |

`fitBox()` then solves the distance against the projected silhouette, iterating
against the real perspective projection — a bounding-sphere estimate frames a
flat instrument far too wide. A clipping guard keeps the maximum extent inside
the frame, which is why a shot may land below its requested `fill`.

**Timings** — shots are absolute (`t`, `d`). Three other constants must move with
them if you retime: `HIDE_FROM` / `HIDE_TO` (when only the detector layers are on
screen — this drops ~2900 of 3600 draw calls) and `LABELS_FROM` / `LABELS_TO`.
A fourth lives in `assets/film-score.js` — see below.

**Materials** — the four housing shells (`cover`, `frame`, `base`) all arrive on
one CAD material called `AluminumPolished` whose numbers are not aluminium:
metalness 0.45 at roughness 0 is a half-dielectric mirror, and it renders as flat
beige plastic. `ALUMINIUM` in `film.js` retargets it to the real thing. Two
consequences if you tune it:

- A fully metallic surface has **no diffuse response** — it can only show
  reflections. So the shells get their own `HOUSING_ENV`, brighter than
  `scene.environment`; raising the scene one instead would relight every board's
  diffuse IBL and change the whole film.
- The sources in that map sit on its **equator**, not its pole. The model is
  Z-up but an equirect is sampled Y-up, so "above the instrument" (world +Z) is
  `u = 0.75` — x = 192, y = 64. A normal top-to-bottom sky gradient lights this
  model sideways.

Because metal takes no diffuse light, `applyLights()` also ramps the shells'
`envMapIntensity` with `LIGHT_LEVEL` — otherwise the housing stays lit through
the opening fade while everything else builds out of black.

---

## The score

`assets/film-score.js`. No audio is downloaded: the default cue is synthesised
with Web Audio — a tonic pedal, hymnal organ chords, a rising sixteenth-note
ostinato, one long build.

**It is driven by the film's playhead, never by wall-clock time.** A scrub is a
seek, and a seek re-cues the organ rather than letting the music drift a few bars
behind the picture. `SECTIONS` is the beat sheet — `[t, chord, dynamic, ostinato]`
— and its times **are** the cut points in `SHOTS` / `CAPTIONS`. Retime a shot and
the matching row must move with it, or the swell lands next to the cut instead of
on it. Density carries the dynamic: quarters, then eighths, then sixteenths, plus
an octave doubling once the storm is on screen.

To use a real track instead, set `SCORE_FILE` in `film.js` to a path under
`assets/`. It then plays in place of the synth, kept in sync through every pause,
scrub and replay; if it fails to load the film falls back to the synth rather
than going silent. `SCORE_OFFSET` picks *which* stretch of a long track plays
under the 64 seconds — film second 0 becomes track second `SCORE_OFFSET`.

Two things to know:

- **This site publishes from git, so a committed track is a published track.**
  Only audio you hold web rights to belongs in `assets/`. `3d/music/` is
  gitignored as a scratch space for auditioning via `?score=`; a file left there
  will never deploy, and in production the page would fall back to the synth.
- Trim and encode to the film rather than seeking into a full-length file. A
  64 s cue at ~128 kbps is about 1 MB; this page already carries an 89 MB model.

Browsers do not start audio without a user gesture, so the transport's **Sound**
control reads `Sound — click` in the accent colour until one arrives, and the
first interaction anywhere on the page starts the cue.

---

## The detector data

`data/hits.bin` — 13,230 one-second exposures, 379,183 hits, 1.5 MB (0.86 MB
gzipped over the wire). Packed from `data/poland_m2_calib.txt` by:

```sh
cd 3d/data && python pack_hits.py poland_m2_calib.txt hits.bin
```

Two things about the source format cost real debugging time:

- The `# Frame:` line is a **trailer** closing the block above it, not a header.
  Read as a header, every frame is labelled with the next frame's pixels. The
  packer verifies all 13,230 frames against their own `Hits:` count.
- Column 3 is raw **Time-over-Threshold clock counts** (1–830), *not* calibrated
  energy despite the `_calib` filename. Column 2 (ToA) is saturated at 262143 in
  99% of rows and carries no usable ordering, so it is discarded.

Frames are sparse — median **3 hits** out of 65,536 pixels — which is why the
film scripts specific frames instead of showing random ones:

| Constant | Meaning |
|---|---|
| `HERO_FRAME` | 57 — one dominant 66-pixel track, the "one particle, one track" beat |
| `STORM_IN` / `STORM_PEAK` | 4200 / 7740 — the flux rise |
| `QUIET_FRAME` | 380 — baseline, ~2 hits/s |
| `LOWER_OFFSET` | Frame offset used for the lower sensor |

**Both dies are lit, but only the upper one shows the track beat.** The data is a
single Timepix2 chip (D7-W0016), so showing correlated hits on two layers would
fabricate a coincidence that isn't in the measurement. The lower layer draws from
a different stretch of the same run.

The colour ramp (`LUT`) runs dark copper → warm → white with a log scale.
Note `hardpix.html` inverts this — it has a stray `e = 1 - e` making weak hits
render hottest.

---

## Architecture

```
film.html          page, styling, transport UI
assets/film.js     the film: scene, lighting, timeline, captions, data playback
assets/film-score.js  the cue: synthesised with Web Audio, or a supplied track,
                     scheduled from the playhead so a scrub re-cues it
assets/model-rig.js  measures any .glb — roles, order, explode, sensors, camera fit
assets/three-lib.js  named re-exports of the three.js/GSAP already shipped in
                     assets/ScrollTrigger-n5D4SfYo.js
data/pack_hits.py  TrackLab text dump -> hits.bin
```

**`three-lib.js` exists because the Vite source project for `/3d/` is not in this
repo** — only its `dist` output. The shipped chunk already bundles three.js, GSAP,
ScrollTrigger, GLTFLoader and OrbitControls under mangled single-letter exports,
so the film re-exports them under real names and adds **no new library bytes**.
Every mapping was verified by instantiating it in a browser.

Consequences worth knowing:

- **`MeshStandardMaterial` is not available** — the chunk exports `MeshBasicMaterial`
  as `p`. The data planes use it with additive blending.
- **No post-processing / EffectComposer**, so glow is faked with a second, softer
  canvas on a slightly larger quad.
- **Enum constants aren't exported**, so raw numbers are used with comments:
  `AdditiveBlending 2`, `NearestFilter 1003`, `LinearFilter 1006`, `DoubleSide 2`,
  `EquirectangularReflectionMapping 303`.

### Two rules that caused real bugs

1. **Never drive discrete state from one-shot GSAP callbacks.** GSAP suppresses
   callbacks when you seek *backwards*, so scrubbing back to the start used to
   leave parts hidden and the wrong caption on screen. Part visibility, captions
   and labels are all derived from the playhead in `syncFilmState()` each frame.
2. **Explode in world units via wrapper Groups.** Each root is re-parented into
   its own `Group` with `attach()`. Tweening `child.position.z` directly means
   tweening metres underneath a ~50× scale — which is why `hardpix.html` flings
   its parts far off screen.

---

## Known bugs in `hardpix.html` (not yet fixed)

Found while building the film; all four are real and none are fixed:

1. Colormap inverted (`e = 1 - e`) — weak hits render hottest.
2. `# Frame:` read as a header — every frame labelled with the next frame's pixels.
3. Sensor lookup for `TIMEPIX3_2LANE_DETECTOR3` never matches; it falls back to
   the whole module bbox, so the heat plane is ~2.4× too big and 8 mm off in X.
4. Explode offsets tweened in model metres under a 54× scale.

---

## Performance and weight

`HardPix2_TPX2.glb` is **88.9 MB / 2.97 M triangles** (3.30 M drawn, 3,618 draw
calls). `Hardpix_Ultrascale_784_2mm` alone is ~91% of the geometry. Shots 5–8
hide everything but the detector layers, which is where the budget is won.

Not yet done, in rough order of value:

- **Compress the model.** 3,864 nodes over 1,492 meshes suggests instancing plus
  meshopt/Draco would cut this hard. Measure before/after rather than assuming.
- The `.glb` is committed to git, so **every future revision adds its full size to
  history permanently**. Worth a plan if the CAD will iterate.
- `moon_2k.jpg` already replaced a 14.3 MB 8K sky (~170 MB VRAM → ~10 MB).

**Headless rendering of this model is unreliable** — Chrome with SwiftShader loses
the WebGL context on 3.3 M triangles and silently renders nothing, which reads as
a black frame rather than an error. Verify framing with `?shots=1` (CPU only) and
trust a real GPU for how it looks.

---

## What the film may claim on screen

The on-screen copy is deliberately conservative. Sourced from a first-party IEAP
CTU poster (Filgas, Malich, Bergmann, ASAPP2023) and UKRI/STFC material:

- ✅ First HardPix launched 12 June 2023, Falcon 9, D-Orbit ION, as UKRI SWIMMR-1.
- ✅ Built at the Institute of Experimental and Applied Physics, CTU Prague.
- ❌ **Do not name the processor.** The CAD says `Ultrascale`, but no public source
  names any processor in HardPix — the poster says only "COTS or RadHard
  processor". The board is labelled "Processing board".
- ❌ Do not state orbit altitude or mass; public sources conflict.
- ⚠️ The data is Timepix2 recorded on the ground. HardPix flies Timepix3; HardPix2
  carries Timepix2. Nothing establishes these frames came from this unit, so the
  film shows them as a "Visualisation of measurement" and claims nothing more.
