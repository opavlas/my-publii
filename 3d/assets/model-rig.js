// Model analysis for the HardPix film.
//
// Everything the film needs to know about a loaded .glb is MEASURED here rather
// than hard-coded, so swapping the model does not mean rewriting the film:
//   - which root is which subsystem (by name tokens, not by CAD ordering)
//   - the true top-to-bottom stacking order (CAD names lie: HARD-PIX-MIDDLE-TOP
//     sits physically BELOW HARD-PIX-MIDDLE-BOT in both models shipped so far)
//   - a collision-free explode layout derived from each part's real thickness
//   - the sensor die(s), found by geometry — flat, near-square, ~14 mm, nothing
//     above them in their own footprint — because the name to look for changed
//     between revisions and the old page's name lookup silently never matched
//   - camera distances solved to fill a chosen fraction of the frame
//
// Pure analysis: nothing here touches the renderer or the timeline.

import { Box3, Vector3, Group } from './three-lib.js'

// Order matters — the specific subsystems are tested before the generic shells.
const ROLE_RULES = [
  { role: 'detector', re: /timepix|tpx|detector|sensor/i },
  { role: 'comms', re: /ethernet|rs422|rs-422|comm|uart|spacewire|can[_-]?bus/i },
  { role: 'processing', re: /zynq|ultrascale|ultra[_-]?scale|fpga|soc|cpu|proc/i },
  { role: 'cover', re: /cover|lid/i },
  { role: 'base', re: /bottom|base|floor/i },
  { role: 'frame', re: /middle|frame|spacer/i },
]

const ROLE_LABEL = {
  cover: 'Cover',
  frame: 'Frame',
  base: 'Base plate',
  detector: 'Detector module',
  processing: 'Processing board',
  comms: 'Comms board',
  unknown: 'Assembly',
}

// Sub-lines are only what published sources support. Nothing names the silicon
// on the processing board, so it stays generic no matter what the CAD calls it.
const ROLE_DETAIL = {
  detector: 'Timepix layer · 256 × 256 pixels',
  processing: 'spectroscopy · particle ID · dosimetry',
  comms: '',
}

function roleOf(name) {
  for (const r of ROLE_RULES) if (r.re.test(name)) return r.role
  return 'unknown'
}

/**
 * Normalise the loaded scene the way the film expects: longest dimension to
 * TARGET_SIZE world units, centred on the origin. Returns the scale applied.
 */
export function normalise(root, targetSize = 5) {
  const box = new Box3().setFromObject(root)
  const size = box.getSize(new Vector3())
  const centre = box.getCenter(new Vector3())
  const s = targetSize / Math.max(size.x, size.y, size.z)
  root.scale.setScalar(s)
  root.position.set(-centre.x * s, -centre.y * s, -centre.z * s)
  root.updateMatrixWorld(true)
  return s
}

/**
 * Wrap every geometry-bearing root in its own Group so the film can translate it
 * in WORLD units. (Tweening child.position under a ~54x scaled parent is what
 * made the shipped hardpix page fling its parts far off screen.)
 */
export function discoverParts(sceneRoot, pivot) {
  const parts = []
  for (const child of sceneRoot.children.slice()) {
    const box = new Box3().setFromObject(child)
    if (box.isEmpty()) continue                     // e.g. the old model's NoDCDC root: 0 meshes
    const size = box.getSize(new Vector3())
    const centre = box.getCenter(new Vector3())
    let tris = 0
    child.traverse(o => {
      const g = o.isMesh && o.geometry
      if (!g) return
      tris += g.index ? g.index.count / 3 : (g.attributes.position ? g.attributes.position.count / 3 : 0)
    })
    const wrap = new Group()
    pivot.add(wrap)
    wrap.attach(child)
    parts.push({
      name: child.name,
      role: roleOf(child.name),
      object: child,
      wrap,
      restBox: box.clone(),
      centre,
      size,
      thickness: size.z,
      triangles: Math.round(tris),
      corners: boxCorners(box),
    })
  }
  // True physical order, top first — measured, never taken from the names.
  parts.sort((a, b) => b.centre.z - a.centre.z)
  parts.forEach((p, i) => { p.stackIndex = i })
  assignLabels(parts)
  return parts
}

function boxCorners(b) {
  return [
    new Vector3(b.min.x, b.min.y, b.min.z), new Vector3(b.max.x, b.min.y, b.min.z),
    new Vector3(b.min.x, b.max.y, b.min.z), new Vector3(b.max.x, b.max.y, b.min.z),
    new Vector3(b.min.x, b.min.y, b.max.z), new Vector3(b.max.x, b.min.y, b.max.z),
    new Vector3(b.min.x, b.max.y, b.max.z), new Vector3(b.max.x, b.max.y, b.max.z),
  ]
}

// When a role appears more than once (two frames, two detector layers) the
// duplicates are disambiguated by measured height, not by their CAD names.
function assignLabels(parts) {
  const byRole = {}
  parts.forEach(p => (byRole[p.role] = byRole[p.role] || []).push(p))
  for (const role of Object.keys(byRole)) {
    const group = byRole[role]
    group.forEach((p, i) => {
      const base = ROLE_LABEL[role] || ROLE_LABEL.unknown
      if (group.length === 1) { p.label = base }
      else if (group.length === 2) { p.label = (i === 0 ? 'Upper ' : 'Lower ') + base.toLowerCase() }
      else { p.label = base + ' ' + (i + 1) }
      p.label = p.label.charAt(0).toUpperCase() + p.label.slice(1)
      p.detail = ROLE_DETAIL[role] || ''
      p.ordinal = i
    })
  }
}

/**
 * Collision-free explode along +Z, derived from each part's measured thickness.
 * Parts keep their stacking order and the spread stays centred on the origin, so
 * this works for any number of layers of any thickness.
 */
export function explodeLayout(parts, gap = 0.30) {
  const total = parts.reduce((a, p) => a + p.thickness, 0) + gap * (parts.length - 1)
  let cursor = total / 2
  const layout = {}
  for (const p of parts) {
    const targetCentre = cursor - p.thickness / 2
    layout[p.name] = targetCentre - p.centre.z
    cursor -= p.thickness + gap
  }
  return layout
}

/** Push everything except `keep` clear of the frame, keeping the stack order. */
export function exitLayout(parts, keep, spread = 6.2) {
  const layout = {}
  const above = parts.filter(p => p.centre.z > keep.centre.z).length
  const below = parts.filter(p => p.centre.z < keep.centre.z).length
  let a = 0, b = 0
  for (const p of parts) {
    if (p === keep) { layout[p.name] = 0; continue }
    if (p.centre.z > keep.centre.z) layout[p.name] = spread * (above - a++) / Math.max(1, above)
    else layout[p.name] = -spread * (++b) / Math.max(1, below)
  }
  return layout
}

/**
 * Find the sensor die inside a detector part by SHAPE, not by name.
 * A Timepix die is a flat near-square plate of roughly 14 mm with nothing above
 * it in its own footprint. mmPerUnit converts world units back to millimetres.
 */
export function findSensor(part, mmPerUnit, opts = {}) {
  const wantMm = opts.wantMm || 14.08
  const minMm = opts.minMm || 9
  const maxMm = opts.maxMm || 22
  const maxThicknessMm = opts.maxThicknessMm || 3.0
  const candidates = []
  const box = new Box3(), size = new Vector3(), centre = new Vector3()
  part.object.traverse(o => {
    if (!o.isMesh) return
    box.setFromObject(o)
    if (box.isEmpty()) return
    box.getSize(size); box.getCenter(centre)
    const wMm = size.x * mmPerUnit, hMm = size.y * mmPerUnit, tMm = size.z * mmPerUnit
    if (tMm > maxThicknessMm) return
    if (wMm < minMm || hMm < minMm || wMm > maxMm || hMm > maxMm) return
    const squareness = Math.min(wMm, hMm) / Math.max(wMm, hMm)
    if (squareness < 0.75) return
    // how close to the wanted active area, and how flat, and how high it sits
    const score = squareness * 2
      - Math.abs(Math.max(wMm, hMm) - wantMm) / wantMm
      - tMm / maxThicknessMm * 0.35
    candidates.push({
      mesh: o, name: o.name, score,
      box: box.clone(), centre: centre.clone(), size: size.clone(),
      widthMm: wMm, heightMm: hMm, thicknessMm: tMm,
    })
  })
  if (!candidates.length) return null
  // Prefer the topmost of the close scorers — the die sits proud of its board.
  candidates.sort((a, b) => b.score - a.score)
  const best = candidates[0]
  const rivals = candidates.filter(c => c.score > best.score - 0.15)
  rivals.sort((a, b) => b.box.max.z - a.box.max.z)
  const win = rivals[0]
  win.topZ = win.box.max.z
  win.activeUnits = wantMm / mmPerUnit
  win.alternatives = candidates.slice(0, 4).map(c =>
    c.name + ' ' + c.widthMm.toFixed(2) + '×' + c.heightMm.toFixed(2) + '×' + c.thicknessMm.toFixed(2) + 'mm')
  return win
}

/**
 * Distance at which a subject of the given bounding-sphere radius fills `fill`
 * of the frame, for a vertical fov and aspect. Portrait viewports fall out of
 * the aspect term instead of needing a fudge factor.
 */
export function fitDistance(radius, fovDeg, aspect, fill = 0.8) {
  const tanV = Math.tan((fovDeg * Math.PI) / 180 / 2)
  const dV = radius / (fill * tanV)
  const dH = radius / (fill * tanV * aspect)
  return Math.max(dV, dH)
}

/**
 * Distance at which a BOX fills `fill` of the frame when viewed along `dir`.
 * Uses the box's real silhouette in camera space, not its bounding sphere — for
 * a flat 5 x 2.2 x 1.1 instrument the sphere is dominated by the long axis and
 * would frame every shot far too wide.
 */
export function fitBox(box, dir, fovDeg, aspect, fill = 0.8, worldUp = new Vector3(0, 0, 1)) {
  const f = dir.clone().normalize().negate()            // camera looks along -dir
  let right = new Vector3().crossVectors(f, worldUp)
  if (right.lengthSq() < 1e-8) right = new Vector3(1, 0, 0)
  right.normalize()
  const up = new Vector3().crossVectors(right, f).normalize()
  const centre = box.getCenter(new Vector3())
  const corners = boxCorners(box)
  const tanV = Math.tan((fovDeg * Math.PI) / 180 / 2)

  let ex = 0, ey = 0, ez = 0
  for (const c of corners) {
    const d = c.clone().sub(centre)
    ex = Math.max(ex, Math.abs(d.dot(right)))
    ey = Math.max(ey, Math.abs(d.dot(up)))
    ez = Math.max(ez, Math.abs(d.dot(f)))
  }
  // First guess ignores depth; then solve against the real perspective
  // projection, because a flat plate seen at 3/4 projects nothing like its
  // orthographic extents and a fixed depth allowance overshoots badly.
  let d = Math.max(ey / (fill * tanV), ex / (fill * tanV * aspect)) + ez
  const camPos = new Vector3(), v = new Vector3()
  // Solve against the real perspective projection. `fill` is the fraction of the
  // frame the subject SPANS — what a viewer reads as size — while the maximum
  // NDC extent is kept under 1 so nothing is clipped. (Under perspective the near
  // corners spread further than the far ones, so the two differ.)
  const measure = () => {
    camPos.copy(dir).normalize().multiplyScalar(d).add(centre)
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, near = Infinity
    for (const c of corners) {
      v.copy(c).sub(camPos)
      const z = v.dot(f)
      near = Math.min(near, z)
      if (z <= 1e-4) return null
      const nx = v.dot(right) / (z * tanV * aspect)
      const ny = v.dot(up) / (z * tanV)
      x0 = Math.min(x0, nx); x1 = Math.max(x1, nx)
      y0 = Math.min(y0, ny); y1 = Math.max(y1, ny)
    }
    return {
      span: Math.max((x1 - x0) / 2, (y1 - y0) / 2),
      max: Math.max(Math.abs(x0), Math.abs(x1), Math.abs(y0), Math.abs(y1)),
      near,
    }
  }
  for (let i = 0; i < 24; i++) {
    const m = measure()
    if (!m) { d *= 1.5; continue }
    if (Math.abs(m.span - fill) < 0.004) break
    d *= m.span / fill
  }
  for (let i = 0; i < 12; i++) {                        // clipping guard
    const m = measure()
    if (!m) { d *= 1.5; continue }
    if (m.max <= 0.99) break
    d *= m.max / 0.99
  }
  return d
}

/** Direction unit vector from azimuth/elevation in degrees (Z-up). */
export function dirFrom(azDeg, elDeg) {
  const az = (azDeg * Math.PI) / 180, el = (elDeg * Math.PI) / 180
  return new Vector3(Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el))
}

/** Bounding sphere radius of a Box3. */
export function radiusOf(box) {
  const s = box.getSize(new Vector3())
  return 0.5 * Math.sqrt(s.x * s.x + s.y * s.y + s.z * s.z)
}

/** A one-line report per part — printed at boot so an unmatched name is visible. */
export function describe(parts, mmPerUnit) {
  return parts.map(p =>
    '#' + p.stackIndex + ' ' + p.name + '  role=' + p.role + '  label="' + p.label + '"' +
    '  z=' + p.centre.z.toFixed(3) +
    '  size=' + (p.size.x * mmPerUnit).toFixed(1) + '×' + (p.size.y * mmPerUnit).toFixed(1) +
    '×' + (p.size.z * mmPerUnit).toFixed(1) + 'mm' +
    '  tris=' + p.triangles)
}
