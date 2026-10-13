import { Color, Fog, Scene } from 'three';
import type { Quaternion, Vector3 } from 'three';
import type { PartInfo } from '../explainer';
import { THEME } from '../theme';
import { CameraRig } from './camera';
import type { CameraOptions, FollowState } from './camera';
import { MAX_FRAME_SECONDS } from './constants';
import { Highlighter } from './highlight';
import { LabelOcclusion } from './labelOcclusion';
import { LabelLayer } from './labels';
import type { GaugeSide } from './lens';
import { createLighting } from './lighting';
import type { Lighting } from './lighting';
import { startLoop } from './loop';
import type { Loop } from './loop';
import { MaterialLibrary, STRUCTURE_GROUP } from './materials';
import type { MaterialLibraryOptions } from './materials';
import { Stage } from './stage';
import { createSceneTextures } from './textures';
import type { SceneTextures } from './textures';
import { afterFirstFrameWhenIdle } from './warmUp';
import { keepOutOverlays, watchKeepOut } from './keepOut';
import { createViewport } from './viewport';
import type { Viewport } from './viewport';

export type FrameUpdate = (deltaSeconds: number) => boolean | void;

export interface FogOptions {
  color: string;
  near: number;
  far: number;
}

export interface SceneOptions {
  background?: string;
  fog?: FogOptions;
  stage?: boolean;
  camera?: CameraOptions;
  highlight?: MaterialLibraryOptions;
  gaugeSide?: GaugeSide;
  ar?: boolean;
}

export interface SceneShell {
  viewport: Viewport;
  scene: Scene;
  rig: CameraRig;
  labels: LabelLayer;
  highlighter: Highlighter;
  materials: MaterialLibrary;
  textures: SceneTextures;
  stage: Stage;
  lighting: Lighting;
  onFrame(update: FrameUpdate): () => void;
  invalidate(): void;
}

export interface PlaybackSource {
  getState(): { tick(deltaSeconds: number): void };
  subscribe(listener: () => void): () => void;
}

export interface XrMode {
  enter(): void;
  exit(): void;
  readonly active: boolean;
}

export interface SceneHost {
  shell: SceneShell;
  xr: XrMode;
  start(playback: PlaybackSource): void;
  dispose(): void;
}

function runUpdates(updates: ReadonlySet<FrameUpdate>, deltaSeconds: number): boolean {
  let moving = false;
  updates.forEach((update) => {
    if (update(deltaSeconds) === true) moving = true;
  });
  return moving;
}

interface SavedRig {
  position: Vector3;
  quaternion: Quaternion;
  target: Vector3;
  follow: FollowState;
}

const MILLISECONDS_PER_SECOND = 1000;

function saveRig(rig: CameraRig): SavedRig {
  return {
    position: rig.camera.position.clone(),
    quaternion: rig.camera.quaternion.clone(),
    target: rig.controls.target.clone(),
    follow: rig.following(),
  };
}

function restoreRig(rig: CameraRig, saved: SavedRig): void {
  rig.jumpTo({ position: saved.position, target: saved.target });
  rig.camera.quaternion.copy(saved.quaternion);
  rig.follow(saved.follow.anchor, saved.follow.mode);
}

function createScene(options: SceneOptions): Scene {
  const scene = new Scene();
  scene.background = new Color(options.background ?? THEME.background);
  if (options.fog) scene.fog = new Fog(options.fog.color, options.fog.near, options.fog.far);
  return scene;
}

export function createSceneHost(
  container: HTMLElement,
  parts: Readonly<Record<string, PartInfo>>,
  options: SceneOptions = {},
): SceneHost {
  const viewport = createViewport(container);
  const scene = createScene(options);
  const lighting = createLighting(scene, viewport.renderer);
  const textures = createSceneTextures();
  const stage = new Stage(textures.shadow);
  if (options.stage ?? true) scene.add(stage.group);
  const materials = new MaterialLibrary(options.highlight);
  const highlighter = new Highlighter(materials, [...Object.keys(parts), STRUCTURE_GROUP]);
  const labels = new LabelLayer(parts);
  const rig = new CameraRig(viewport.renderer.domElement, options.camera);
  const occlusion = new LabelOcclusion(labels, {
    scene,
    camera: rig.camera,
    partOf: (material) => materials.groupOf(material),
    ignored: [stage.group],
  });
  const updates = new Set<FrameUpdate>();
  let loop: Loop | undefined;
  let playback: PlaybackSource | undefined;
  let savedRig: SavedRig | undefined;
  let lastXrTime: number | undefined;
  let needsRender = true;
  let disposed = false;
  let stopPlayback = () => {};
  let cancelWarmUp = () => {};

  const invalidate = () => {
    needsRender = true;
    loop?.request();
  };
  const removers = [
    viewport.onResize((size) => {
      rig.setViewport(size);
      labels.setViewport(size);
      invalidate();
    }),
    rig.onChange(invalidate),
    labels.onChange(invalidate),
    highlighter.onChange(invalidate),
    watchKeepOut(viewport.element, keepOutOverlays(container), (areas) => labels.setKeepOut(areas)),
  ];

  const shell: SceneShell = {
    viewport,
    scene,
    rig,
    labels,
    highlighter,
    materials,
    textures,
    stage,
    lighting,
    onFrame: (update) => {
      updates.add(update);
      return () => updates.delete(update);
    },
    invalidate,
  };

  const advance = (source: PlaybackSource, deltaSeconds: number): number => {
    const step = Math.min(deltaSeconds, MAX_FRAME_SECONDS);
    source.getState().tick(step);
    if (runUpdates(updates, step)) invalidate();
    if (highlighter.update(step)) {
      occlusion.invalidate();
      invalidate();
    }
    rig.update(step);
    return step;
  };

  const renderFrame = (source: PlaybackSource, deltaSeconds: number) => {
    const step = advance(source, deltaSeconds);
    if (occlusion.update(step)) loop?.request();
    if (!needsRender) return;
    needsRender = false;
    viewport.render(scene, rig.camera);
    labels.layout(rig.camera);
  };

  const startFrames = (source: PlaybackSource) => {
    loop?.stop();
    loop = startLoop((deltaSeconds) => renderFrame(source, deltaSeconds));
  };

  const renderXrFrame = (time: number) => {
    const deltaSeconds =
      lastXrTime === undefined ? 0 : Math.max(0, (time - lastXrTime) / MILLISECONDS_PER_SECOND);
    lastXrTime = time;
    if (playback) advance(playback, deltaSeconds);
    needsRender = false;
    viewport.render(scene, rig.camera);
  };

  const xr: XrMode = {
    get active() {
      return savedRig !== undefined;
    },
    enter: () => {
      if (disposed || savedRig) return;
      savedRig = saveRig(rig);
      loop?.stop();
      loop = undefined;
      lastXrTime = undefined;
      viewport.setPaused(true);
      viewport.renderer.setAnimationLoop(renderXrFrame);
    },
    exit: () => {
      if (!savedRig) return;
      const saved = savedRig;
      savedRig = undefined;
      viewport.renderer.setAnimationLoop(null);
      viewport.setPaused(false);
      restoreRig(rig, saved);
      occlusion.invalidate();
      if (playback && !disposed) startFrames(playback);
      invalidate();
    },
  };

  const run = (source: PlaybackSource) => {
    if (disposed) return;
    playback = source;
    stopPlayback();
    if (!savedRig) startFrames(source);
    stopPlayback = source.subscribe(invalidate);
    invalidate();
    cancelWarmUp();
    cancelWarmUp = afterFirstFrameWhenIdle(() =>
      materials.compileFadedVariants(() => viewport.renderer.compileAsync(scene, rig.camera)),
    );
  };

  return {
    shell,
    xr,
    start: (source) => {
      void viewport.renderer.compileAsync(scene, rig.camera).then(() => run(source));
    },
    dispose: () => {
      if (savedRig) viewport.renderer.setAnimationLoop(null);
      savedRig = undefined;
      disposed = true;
      cancelWarmUp();
      loop?.stop();
      stopPlayback();
      removers.forEach((remove) => remove());
      updates.clear();
      labels.dispose();
      rig.dispose();
      stage.dispose();
      materials.dispose();
      textures.dispose();
      lighting.dispose();
      viewport.dispose();
    },
  };
}
