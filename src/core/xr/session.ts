import { Vector3 } from 'three';
import type { Group, Matrix4 } from 'three';
import { t } from '../i18n';
import { TEXT_ATTRIBUTE } from '../i18n/markup';
import type { Point } from '../scene/labelLayout';
import type { SceneHost } from '../scene/shell';
import { requireElement } from '../ui/dom';
import { TAKEOVER_ATTRIBUTE } from '../ui/stageExpansion';
import { prepareArScene } from './arScene';
import type { ArScene } from './arScene';
import { pinchScale, touchAngle, touchDistance, twistYaw } from './gestures';
import { setArDepth } from './depth';
import { createPlacement } from './placement';

export interface ArSession {
  end(): Promise<void>;
}

const AR_MODE = 'immersive-ar';
const FLOOR_SPACE = 'local-floor';
const LOCAL_SPACE = 'local';
const VIEWER_SPACE = 'viewer';
const AR_ATTRIBUTE = 'data-ar';
const FADED_ATTRIBUTE = 'data-faded';
const HINT_FADE_MS = 3000;
const UI_SELECTOR = '[data-ar-ui]';
const HINT_SELECTOR = '[data-ar-hint]';
const EXIT_SELECTOR = '[data-control="ar-exit"]';
const DOCK_SELECTOR = '[data-dock]';
const GAUGE_SELECTOR = '[data-gauge]';
const OVERLAY_SELECTOR = `${DOCK_SELECTOR}, ${GAUGE_SELECTOR}, ${UI_SELECTOR}`;
const BEFORE_SELECT = 'beforexrselect';

interface Overlay {
  ui: HTMLElement;
  hint: HTMLElement;
  exit: HTMLButtonElement;
  shields: HTMLElement[];
}

interface Spaces {
  reference: XRReferenceSpace;
  viewer: XRReferenceSpace;
}

interface Twist {
  readonly active: boolean;
  dispose(): void;
}

interface TwistStart {
  distance: number;
  angle: number;
  scale: number;
  yaw: number;
}

export function writeCopy(element: HTMLElement, key: string): void {
  element.setAttribute(TEXT_ATTRIBUTE, key);
  element.textContent = t(key);
}

function findOverlay(stage: HTMLElement): Overlay {
  return {
    ui: requireElement(stage, UI_SELECTOR),
    hint: requireElement(stage, HINT_SELECTOR),
    exit: requireElement<HTMLButtonElement>(stage, EXIT_SELECTOR),
    shields: [DOCK_SELECTOR, GAUGE_SELECTOR, UI_SELECTOR].map((selector) =>
      requireElement(stage, selector),
    ),
  };
}

function isOverlayTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(OVERLAY_SELECTOR) !== null;
}

function preventSelect(event: Event): void {
  event.preventDefault();
}

function faceViewer(at: Vector3, viewer: DOMPointReadOnly): number {
  return Math.atan2(viewer.x - at.x, viewer.z - at.z);
}

function watchTwist(stage: HTMLElement, anchor: Group, enabled: () => boolean): Twist {
  const pointers = new Map<number, Point>();
  let start: TwistStart | undefined;

  const pair = (): [Point, Point] | undefined => {
    const [a, b] = [...pointers.values()];
    return pointers.size === 2 && a && b ? [a, b] : undefined;
  };
  const begin = () => {
    const points = pair();
    start = points && {
      distance: touchDistance(...points),
      angle: touchAngle(...points),
      scale: anchor.scale.x,
      yaw: anchor.rotation.y,
    };
  };
  const onDown = (event: PointerEvent) => {
    if (!enabled() || isOverlayTarget(event.target)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    begin();
  };
  const onMove = (event: PointerEvent) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const points = pair();
    if (!start || !points) return;
    if (Number.isFinite(start.distance) && start.distance > 0) {
      anchor.scale.setScalar(pinchScale(start.scale, start.distance, touchDistance(...points)));
    }
    anchor.rotation.y = twistYaw(start.yaw, start.angle, touchAngle(...points));
  };
  const onUp = (event: PointerEvent) => {
    if (pointers.delete(event.pointerId)) begin();
  };

  stage.addEventListener('pointerdown', onDown);
  stage.addEventListener('pointermove', onMove);
  stage.addEventListener('pointerup', onUp);
  stage.addEventListener('pointercancel', onUp);
  return {
    get active() {
      return start !== undefined;
    },
    dispose: () => {
      stage.removeEventListener('pointerdown', onDown);
      stage.removeEventListener('pointermove', onMove);
      stage.removeEventListener('pointerup', onUp);
      stage.removeEventListener('pointercancel', onUp);
      pointers.clear();
      start = undefined;
    },
  };
}

function track(
  host: SceneHost,
  stage: HTMLElement,
  session: XRSession,
  overlay: Overlay,
  arScene: ArScene,
  spaces: Spaces,
): () => void {
  const { shell } = host;
  const renderer = shell.viewport.renderer;
  const { anchor } = arScene;
  const { hint } = overlay;
  const placement = createPlacement(session, spaces.reference, spaces.viewer);
  const selecting = new Set<XRInputSource>();
  let placed = false;
  let surfaceFound = false;
  let lastHit: Matrix4 | undefined;
  let viewer: DOMPointReadOnly | undefined;
  let dragOffset: Vector3 | undefined;
  let fadeTimer: ReturnType<typeof setTimeout> | undefined;
  const twist = watchTwist(stage, anchor, () => placed);

  shell.scene.add(placement.reticle);
  anchor.visible = false;
  hint.removeAttribute(FADED_ATTRIBUTE);
  writeCopy(hint, 'ar.find');

  const place = () => {
    if (!lastHit) return;
    anchor.position.setFromMatrixPosition(lastHit);
    anchor.rotation.y = viewer ? faceViewer(anchor.position, viewer) : 0;
    anchor.visible = true;
    placed = true;
    placement.reticle.visible = false;
    writeCopy(hint, 'ar.gestures');
    fadeTimer = setTimeout(() => hint.setAttribute(FADED_ATTRIBUTE, ''), HINT_FADE_MS);
  };

  const findSurface = (frame: XRFrame) => {
    lastHit = placement.update(frame);
    viewer = frame.getViewerPose(spaces.reference)?.transform.position;
    if (!lastHit || surfaceFound) return;
    surfaceFound = true;
    writeCopy(hint, 'ar.place');
  };

  const drag = (frame: XRFrame) => {
    const [input] = selecting;
    if (!input || selecting.size !== 1 || twist.active) {
      dragOffset = undefined;
      return;
    }
    const hit = placement.placeAt(frame, input);
    if (!hit) return;
    const point = new Vector3().setFromMatrixPosition(hit);
    if (dragOffset) anchor.position.copy(point).add(dragOffset);
    else dragOffset = anchor.position.clone().sub(point);
  };

  const stopFrames = shell.onFrame(() => {
    const frame = renderer.xr.getFrame();
    if (!frame) return;
    if (placed) drag(frame);
    else findSurface(frame);
  });

  const onSelectStart = (event: XRInputSourceEvent) => {
    selecting.add(event.inputSource);
    dragOffset = undefined;
  };
  const onSelectEnd = (event: XRInputSourceEvent) => {
    selecting.delete(event.inputSource);
    dragOffset = undefined;
  };
  const onSelect = () => {
    if (!placed) place();
  };
  const onExit = () => {
    session.end().catch(() => {});
  };

  session.addEventListener('selectstart', onSelectStart);
  session.addEventListener('selectend', onSelectEnd);
  session.addEventListener('select', onSelect);
  overlay.exit.addEventListener('click', onExit);
  overlay.shields.forEach((element) => element.addEventListener(BEFORE_SELECT, preventSelect));

  return () => {
    clearTimeout(fadeTimer);
    stopFrames();
    twist.dispose();
    session.removeEventListener('selectstart', onSelectStart);
    session.removeEventListener('selectend', onSelectEnd);
    session.removeEventListener('select', onSelect);
    overlay.exit.removeEventListener('click', onExit);
    overlay.shields.forEach((element) => element.removeEventListener(BEFORE_SELECT, preventSelect));
    placement.dispose();
  };
}

async function begin(host: SceneHost, stage: HTMLElement, session: XRSession): Promise<void> {
  const { shell } = host;
  const { controls } = shell.rig;
  const xr = shell.viewport.renderer.xr;
  const overlay = findOverlay(stage);
  const controlsEnabled = controls.enabled;
  let arScene: ArScene | undefined;
  let stopTracking = () => {};
  let restoreDepth = () => {};
  let ended = false;

  const teardown = () => {
    if (ended) return;
    ended = true;
    xr.removeEventListener('sessionend', teardown);
    stopTracking();
    arScene?.restore();
    host.xr.exit();
    restoreDepth();
    xr.enabled = false;
    controls.enabled = controlsEnabled;
    stage.removeAttribute(AR_ATTRIBUTE);
    overlay.ui.hidden = true;
    stage.removeAttribute(TAKEOVER_ATTRIBUTE);
  };

  xr.addEventListener('sessionend', teardown);
  try {
    xr.enabled = true;
    xr.setReferenceSpaceType(
      session.enabledFeatures?.includes(FLOOR_SPACE) ? FLOOR_SPACE : LOCAL_SPACE,
    );
    await xr.setSession(session);
    const viewer = await session.requestReferenceSpace(VIEWER_SPACE);
    const reference = xr.getReferenceSpace();
    if (ended) return;
    if (!reference) throw new Error('The AR session has no reference space');
    arScene = prepareArScene(shell);
    restoreDepth = setArDepth(shell.rig.camera);
    host.xr.enter();
    controls.enabled = false;
    stopTracking = track(host, stage, session, overlay, arScene, { reference, viewer });
    stage.setAttribute(AR_ATTRIBUTE, '');
    overlay.ui.hidden = false;
  } catch (error) {
    teardown();
    throw error;
  }
}

export async function startArSession(
  host: SceneHost,
  stage: HTMLElement,
  xr: XRSystem,
): Promise<ArSession> {
  stage.setAttribute(TAKEOVER_ATTRIBUTE, '');
  const session = await xr
    .requestSession(AR_MODE, {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['dom-overlay', FLOOR_SPACE],
      domOverlay: { root: stage },
    })
    .catch((error: unknown) => {
      stage.removeAttribute(TAKEOVER_ATTRIBUTE);
      throw error;
    });
  const end = () => session.end().catch(() => {});
  try {
    await begin(host, stage, session);
  } catch (error) {
    await end();
    throw error;
  }
  return { end };
}
