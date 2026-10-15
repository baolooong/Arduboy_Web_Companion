// ============================================================================
// 3D model view. Renders model/model.glb (Arduboy STEP converted to GLB
// offline — three.js has no STEP loader) with the live 128x64 screen texture
// mapped onto the calibrated screen area, plus button press animation.
//
// The STEP parts carry no names ("NONE"), so geometry targeting reads
// src/config/calibration.json: screen plane (center/normal/w/h in model
// units) and per-button press axis + depth. Measure the real values with
// tools/calibrate.html and overwrite that file.
//
// If model/model.glb is missing, initViewer reports 'model-missing' via
// onStatus and keeps rendering an empty scene (the app shows its own
// fallback overlay). OrbitControls stay usable either way.
// ============================================================================

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { BUTTONS } from './protocol.js';
import calibration from './config/calibration.json';

// Button keys and their real Arduboy2 bit values (see protocol.js BUTTONS).
const BTN_KEYS = ['up', 'right', 'left', 'down', 'a', 'b'];
const BTN_BITS = [BUTTONS.UP, BUTTONS.RIGHT, BUTTONS.LEFT, BUTTONS.DOWN, BUTTONS.A, BUTTONS.B];
const SCREEN_LIFT = 0.15; // mm above the shell surface, avoids z-fighting
const DOT_RADIUS = 1.2; // fallback indicator dot radius (mm)
const EDGE_THRESHOLD = 30; // degrees — sharp CAD corners only, no tessellation noise
const FIT_SIZE = 40; // world units for the model's largest side after fit
const PRESS_GLOW = new THREE.Color(0xf6b73c); // amber, matches CSS var(--amber)

let viewer = null; // set by initViewer; the named exports below delegate to it

export function initViewer(container, onStatus) {
  viewer = createViewer(container, onStatus);
  return viewer;
}

// No-op until initViewer has been called.
export function viewerSetScreenSource(canvas) { viewer?.setScreenSource(canvas); }
export function viewerSetButtonState(buttons) { viewer?.setButtonState(buttons); }
export function viewerSetSize() { viewer?.setSize(); }

function createViewer(container, onStatus) {
  // Reuse the panel's existing <canvas id="viewer"> when present.
  const renderer = new THREE.WebGLRenderer({
    canvas: container.querySelector('canvas') || undefined,
    antialias: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  const el = renderer.domElement;
  el.style.width = '100%';
  el.style.height = '100%';
  el.style.display = 'block';
  if (!el.parentElement) container.appendChild(el);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x14161a); // app dark theme

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
  camera.position.set(30, 18, 30);

  const controls = new OrbitControls(camera, el);
  controls.enableDamping = true;
  controls.target.set(0, 0, 0);

  // Product-shot lighting: cool ambient fill + warm directional key.
  scene.add(new THREE.HemisphereLight(0xffffff, 0x2e323d, 1.1));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(5, 8, 6);
  scene.add(key);

  const grid = new THREE.GridHelper(100, 20, 0x2e323d, 0x22252c);
  grid.position.y = -25;
  scene.add(grid);

  // All calibration-driven objects live in this group so calibration values
  // stay in model units (mm) even after the fit scale/offset is applied.
  const modelGroup = new THREE.Group();
  scene.add(modelGroup);

  // Screen plane: live game image; toneMapped off so pixels read bright.
  const screenMat = new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: false });
  const screenPlane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), screenMat);
  modelGroup.add(screenPlane);
  let screenTexture = null;

  function applyCalibration() {
    const s = calibration.screen || {};
    const n = new THREE.Vector3(s.normal?.x ?? 0, s.normal?.y ?? 0, s.normal?.z ?? 1).normalize();
    screenPlane.geometry.dispose();
    screenPlane.geometry = new THREE.PlaneGeometry(s.w ?? 26, s.h ?? 13);
    screenPlane.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    screenPlane.position.set(s.x ?? 0, s.y ?? 0, s.z ?? 0).addScaledVector(n, SCREEN_LIFT);
  }
  applyCalibration();

  // Button state + fallback indicator dots (one per button).
  const buttons = {};
  for (const btnKey of BTN_KEYS) {
    const b = calibration.buttons?.[btnKey] || {};
    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(DOT_RADIUS, 16, 12),
      new THREE.MeshStandardMaterial({ color: 0x2a2d35, roughness: 0.5, metalness: 0.1 })
    );
    modelGroup.add(dot);
    buttons[btnKey] = {
      pos: new THREE.Vector3(b.x ?? 0, b.y ?? 0, b.z ?? 0),
      n: new THREE.Vector3(b.normal?.x ?? 0, b.normal?.y ?? 0, b.normal?.z ?? 1).normalize(),
      depth: b.depth ?? 1,
      meshName: b.meshName || null,
      mesh: null, // resolved after load when the GLB contains that name
      dot,
      pressed: false,
      press: 0, // eased 0..1
    };
  }

  // ---- model loading (fetch first so a missing file is detected cleanly) ----
  const loader = new GLTFLoader();
  fetch('/model/model.glb')
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.arrayBuffer();
    })
    .then((buf) => loader.parseAsync(buf, '')) // GLB: everything is embedded
    .then((gltf) => {
      modelGroup.add(gltf.scene);
      addEdges(gltf.scene);
      fitToView(gltf.scene);
      linkButtonMeshes();
      onStatus?.('model-loaded');
    })
    .catch(() => onStatus?.('model-missing'));

  // Crisp CAD look: black hard-edge lines per mesh. Negative polygonOffset
  // pulls the lines toward the camera so they never z-fight the surface.
  function addEdges(root) {
    root.traverse((o) => {
      if (!o.isMesh) return;
      o.add(new THREE.LineSegments(
        new THREE.EdgesGeometry(o.geometry, EDGE_THRESHOLD),
        new THREE.LineBasicMaterial({
          color: 0x101216,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1,
        })
      ));
    });
  }

  // Bounding-box fit: center the model on the origin, normalize its largest
  // side to FIT_SIZE units, pull the camera back so it fills the viewport at
  // any panel aspect ratio.
  function fitToView(root) {
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const fit = FIT_SIZE / maxDim;
    modelGroup.scale.setScalar(fit);
    modelGroup.position.copy(center).multiplyScalar(-fit);

    const half = FIT_SIZE / 2;
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
    const dist = Math.max(half / tanHalf, half / (tanHalf * camera.aspect)) * 1.2;
    camera.position.set(dist * 0.6, dist * 0.35, dist);
    camera.near = Math.max(0.1, dist * 0.05);
    camera.far = dist * 10;
    camera.updateProjectionMatrix();
    controls.target.set(0, 0, 0);
    controls.update();
    grid.position.y = -half - 3;
  }

  // Path (a): if calibration names a mesh, animate that mesh directly.
  function linkButtonMeshes() {
    for (const btnKey of BTN_KEYS) {
      const b = buttons[btnKey];
      if (!b.meshName) continue;
      const mesh = modelGroup.getObjectByName(b.meshName);
      if (mesh) b.mesh = mesh; // name not in the GLB -> indicator dot instead
    }
  }

  // Press animation. (a) Named mesh translates along the press normal.
  // (b) Otherwise the indicator dot sinks and glows. Both ease in/out.
  const clock = new THREE.Clock();
  function updateButtons(dt) {
    for (const btnKey of BTN_KEYS) {
      const b = buttons[btnKey];
      b.press += ((b.pressed ? 1 : 0) - b.press) * Math.min(1, dt * 14);
      if (b.press < 0.01 && !b.pressed) b.press = 0;
      const k = b.press;
      if (b.mesh) {
        b.dot.visible = false;
        // Move in world space, then back into the parent's local space
        // (parents may carry their own rotations).
        const w = new THREE.Vector3();
        b.mesh.getWorldPosition(w).addScaledVector(b.n, -b.depth * k);
        b.mesh.position.copy(b.mesh.parent ? b.mesh.parent.worldToLocal(w) : w);
      } else {
        b.dot.visible = true;
        b.dot.position.copy(b.pos).addScaledVector(b.n, DOT_RADIUS * 0.8 - b.depth * k);
        b.dot.material.emissive.copy(PRESS_GLOW).multiplyScalar(k);
      }
    }
  }

  renderer.setAnimationLoop(() => {
    const dt = clock.getDelta();
    updateButtons(dt);
    if (screenTexture) screenTexture.needsUpdate = true; // live canvas, upload every frame
    controls.update();
    renderer.render(scene, camera);
  });

  // ---- public API ----------------------------------------------------------
  function setScreenSource(canvas) {
    if (canvas && screenTexture && screenTexture.image === canvas) return;
    if (!canvas) {
      screenMat.map = null;
      screenMat.color.set(0x000000);
      screenTexture = null;
      return;
    }
    screenTexture = new THREE.CanvasTexture(canvas);
    screenTexture.magFilter = THREE.NearestFilter; // 128x64 upscaled — keep pixels crisp
    screenTexture.minFilter = THREE.NearestFilter;
    screenTexture.generateMipmaps = false;
    screenTexture.colorSpace = THREE.SRGBColorSpace;
    screenMat.map = screenTexture;
    screenMat.color.set(0xffffff);
  }

  function setButtonState(bitmask) {
    for (let i = 0; i < BTN_KEYS.length; i++) {
      buttons[BTN_KEYS[i]].pressed = !!(bitmask & BTN_BITS[i]);
    }
  }

  function setSize() {
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  window.addEventListener('resize', setSize);

  function dispose() {
    window.removeEventListener('resize', setSize);
    renderer.setAnimationLoop(null);
    controls.dispose();
    renderer.dispose();
    el.remove();
  }

  return { setScreenSource, setButtonState, setSize, dispose };
}
