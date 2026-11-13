import { AmbientLight, Box3, DirectionalLight, Group, HemisphereLight, MathUtils, PerspectiveCamera, Scene, SRGBColorSpace, Vector3, WebGLRenderer } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

/*
 * 本 The Silkscreen Kimono, turning: the e-reader's case (iandchasse's
 * Silkscreen enclosure, CERN-OHL-S-2.0) with Kimono's branch on its back.
 * Loaded only by a profile that has the badge (silkscreen.tsx), so three.js
 * stays out of every other page. It turns slowly by itself unless motion is
 * reduced, spins when dragged, and turns over when asked.
 */

export const MODEL = "/models/silkscreen-kimono/silkscreen-kimono.glb";

export type Turntable = { turnOver: () => void; dispose: () => void };

export async function mountTurntable(host: HTMLElement, options: { still: boolean; onTurned?: (back: boolean) => void }): Promise<Turntable> {
  const renderer = new WebGLRenderer({ antialias: true, alpha: true });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  host.appendChild(renderer.domElement);

  const scene = new Scene();
  const camera = new PerspectiveCamera(26, 1, 0.1, 100);
  scene.add(new HemisphereLight(0xfffaf2, 0x8a8478, 1.5), new AmbientLight(0xffffff, 0.35));
  const key = new DirectionalLight(0xffffff, 2.2);
  key.position.set(2.5, 3, 4);
  const rim = new DirectionalLight(0xfff1e6, 1.1);
  rim.position.set(-3, 1.5, -4);
  scene.add(key, rim);

  const turn = new Group();
  scene.add(turn);
  const gltf = await new GLTFLoader().loadAsync(MODEL);
  const model = gltf.scene;
  const box = new Box3().setFromObject(model);
  model.position.sub(box.getCenter(new Vector3()));
  turn.add(model);
  turn.rotation.x = MathUtils.degToRad(-8);
  const size = box.getSize(new Vector3());
  const fit = Math.max(size.y, size.x * 1.3) / 2 / Math.tan(MathUtils.degToRad(camera.fov / 2));
  camera.position.set(0, size.y * 0.06, fit * 1.12);
  camera.lookAt(0, 0, 0);

  const size2d = () => {
    const { width, height } = host.getBoundingClientRect();
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(1, height);
    camera.updateProjectionMatrix();
  };
  size2d();
  const resized = new ResizeObserver(size2d);
  resized.observe(host);

  /* Turning: a slow drift unless motion is reduced; a drag spins it and lets go with a little run; turning over eases half a turn. */
  let angle = MathUtils.degToRad(-24), speed = 0, target: number | null = null, dragging = false, lastX = 0, lastT = 0;
  const drift = options.still ? 0 : 0.35;
  let wasBack = false;
  /* A press that hardly moves is a tap: it turns the case over. */
  let travel = 0;
  const down = (e: PointerEvent) => { dragging = true; target = null; travel = 0; lastX = e.clientX; lastT = e.timeStamp; speed = 0; host.setPointerCapture(e.pointerId); };
  const move = (e: PointerEvent) => {
    if (!dragging) return;
    const dx = e.clientX - lastX, dt = Math.max(1, e.timeStamp - lastT);
    travel += Math.abs(dx);
    angle += dx * 0.03;
    speed = (dx * 0.03) / (dt / 1000);
    lastX = e.clientX; lastT = e.timeStamp;
  };
  const up = (e: PointerEvent) => { const tap = dragging && e.type === "pointerup" && travel < 4; dragging = false; if (tap) turnOver(); };
  host.addEventListener("pointerdown", down);
  host.addEventListener("pointermove", move);
  host.addEventListener("pointerup", up);
  host.addEventListener("pointercancel", up);

  let shown = true;
  const seen = new IntersectionObserver(([entry]) => { shown = entry.isIntersecting; });
  seen.observe(host);

  let last = performance.now(), frame = 0;
  const tick = (now: number) => {
    frame = requestAnimationFrame(tick);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!shown || document.hidden) return;
    if (target !== null) {
      const left = target - angle;
      angle += left * Math.min(1, dt * 6);
      if (Math.abs(left) < 0.002) { angle = target; target = null; }
    } else if (!dragging) {
      speed *= Math.pow(0.04, dt);
      angle += (speed + drift) * dt;
    }
    turn.rotation.y = angle;
    const back = Math.cos(angle) < 0;
    if (back !== wasBack) { wasBack = back; options.onTurned?.(back); }
    renderer.render(scene, camera);
  };
  frame = requestAnimationFrame(tick);

  /* Half a turn, to whichever face isn't showing, square on. */
  function turnOver() {
    const face = Math.round(angle / Math.PI) * Math.PI;
    target = face + Math.PI;
    speed = 0;
  }

  return {
    turnOver,
    dispose: () => {
      cancelAnimationFrame(frame);
      resized.disconnect();
      seen.disconnect();
      host.removeEventListener("pointerdown", down);
      host.removeEventListener("pointermove", move);
      host.removeEventListener("pointerup", up);
      host.removeEventListener("pointercancel", up);
      model.traverse((o) => {
        const mesh = o as { geometry?: { dispose(): void }; material?: { dispose(): void; map?: { dispose(): void } | null } };
        mesh.geometry?.dispose();
        mesh.material?.map?.dispose();
        mesh.material?.dispose();
      });
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
