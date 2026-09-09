// Named re-exports of the three.js + GSAP runtime that is already shipped in the
// Vite chunk ScrollTrigger-n5D4SfYo.js. The Vite source project for /3d/ is not in
// this repo, so hand-written modules (film.js) import from here instead of adding a
// second copy of three.js. Every mapping below was verified by instantiating it in
// a browser and checking .type / behaviour against the chunk.
export {
  _ as Scene,
  a as WebGLRenderer,
  b as Vector3,
  c as CanvasTexture,
  d as Group,
  f as Mesh,
  g as RepeatWrapping,
  h as PlaneGeometry,
  i as GLTFLoader,
  l as Color,
  m as PerspectiveCamera,
  n as gsap,
  o as AmbientLight,
  p as MeshBasicMaterial,
  r as OrbitControls,
  s as Box3,
  t as ScrollTrigger,
  u as DirectionalLight,
  v as SphereGeometry,
  y as TextureLoader,
} from './ScrollTrigger-n5D4SfYo.js'
