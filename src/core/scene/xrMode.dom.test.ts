import { Object3D, Quaternion, Vector3 } from 'three';
import type * as Three from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LabelOcclusion } from './labelOcclusion';
import { createSceneHost } from './shell';
import type { PlaybackSource, SceneHost } from './shell';

type XrLoop = ((time: number) => void) | null;

const fakes = vi.hoisted(() => {
  class FakeRenderer {
    readonly domElement = document.createElement('canvas');
    readonly debug = { checkShaderErrors: false };
    readonly xr = { enabled: false };
    outputColorSpace = '';
    toneMapping = 0;
    toneMappingExposure = 1;
    readonly setPixelRatio = vi.fn();
    readonly setSize = vi.fn();
    readonly render = vi.fn();
    readonly dispose = vi.fn();
    readonly compileAsync = vi.fn(() => Promise.resolve());
    readonly setAnimationLoop = vi.fn();
    constructor() {
      renderers.push(this);
    }
  }
  const renderers: FakeRenderer[] = [];
  return { FakeRenderer, renderers };
});

vi.mock('three', async (importOriginal) => ({
  ...(await importOriginal<typeof Three>()),
  WebGLRenderer: fakes.FakeRenderer,
}));

vi.mock('./lighting', () => ({
  createLighting: () => ({ dispose: () => {} }),
}));

const FRAME_MS = 16;
const SETTLE_FRAMES = 200;

interface FrameQueue {
  pending(): number;
  flush(at: number): void;
}

function stubAnimationFrames(): FrameQueue {
  let queue = new Map<number, FrameRequestCallback>();
  let next = 1;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    queue.set(next, callback);
    return next++;
  });
  vi.stubGlobal('cancelAnimationFrame', (handle: number) => queue.delete(handle));
  return {
    pending: () => queue.size,
    flush: (at) => {
      const due = queue;
      queue = new Map();
      due.forEach((callback) => callback(at));
    },
  };
}

function stubObservers(): () => void {
  const callbacks: ((entries: ResizeObserverEntry[]) => void)[] = [];
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: (entries: ResizeObserverEntry[]) => void) {
        callbacks.push(callback);
      }
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal('requestIdleCallback', () => 0);
  vi.stubGlobal('cancelIdleCallback', () => {});
  return () => callbacks.forEach((callback) => callback([]));
}

function renderer() {
  const last = fakes.renderers.at(-1);
  if (!last) throw new Error('No renderer');
  return last;
}

function xrLoop(): (time: number) => void {
  const loop = renderer().setAnimationLoop.mock.calls.at(-1)?.[0] as XrLoop;
  if (!loop) throw new Error('No XR loop');
  return loop;
}

describe('scene host XR mode', () => {
  let frames: FrameQueue;
  let resizeAll: () => void;
  let host: SceneHost;
  let now = 0;
  const tick = vi.fn();
  const playback: PlaybackSource = {
    getState: () => ({ tick }),
    subscribe: () => () => {},
  };

  const settle = () => {
    for (let count = 0; count < SETTLE_FRAMES && frames.pending() > 0; count += 1) {
      now += FRAME_MS;
      frames.flush(now);
    }
  };

  beforeEach(async () => {
    frames = stubAnimationFrames();
    resizeAll = stubObservers();
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    document.body.innerHTML = '<div id="scene"></div>';
    const container = document.getElementById('scene');
    if (!container) throw new Error('No container');
    host = createSceneHost(container, {});
    host.start(playback);
    await Promise.resolve();
    await Promise.resolve();
    settle();
    tick.mockClear();
  });

  afterEach(() => {
    host.dispose();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('hands frames to the XR animation loop on enter', () => {
    expect(host.xr.active).toBe(false);
    host.xr.enter();
    expect(host.xr.active).toBe(true);
    expect(renderer().setAnimationLoop).toHaveBeenCalledWith(expect.any(Function));
    host.shell.invalidate();
    expect(frames.pending()).toBe(0);
  });

  it('renders every XR frame without label layout or occlusion', () => {
    const update = vi.fn();
    host.shell.onFrame(update);
    const layout = vi.spyOn(host.shell.labels, 'layout');
    const occlusion = vi.spyOn(LabelOcclusion.prototype, 'update');
    host.xr.enter();
    renderer().render.mockClear();
    const frame = xrLoop();
    frame(1000);
    frame(1000 + FRAME_MS);
    frame(1000 + 2 * FRAME_MS);
    expect(tick).toHaveBeenCalledTimes(3);
    expect(tick).toHaveBeenLastCalledWith(FRAME_MS / 1000);
    expect(update).toHaveBeenCalledTimes(3);
    expect(renderer().render).toHaveBeenCalledTimes(3);
    expect(layout).not.toHaveBeenCalled();
    expect(occlusion).not.toHaveBeenCalled();
  });

  it('leaves the renderer size to XR while active', () => {
    host.xr.enter();
    renderer().setSize.mockClear();
    resizeAll();
    expect(renderer().setSize).not.toHaveBeenCalled();
    host.xr.exit();
    expect(renderer().setSize).toHaveBeenCalled();
    renderer().setSize.mockClear();
    resizeAll();
    expect(renderer().setSize).toHaveBeenCalled();
  });

  it('restores the camera, the follow anchor and the frame loop on exit', () => {
    const { rig } = host.shell;
    const anchor = new Object3D();
    anchor.position.set(1, 0, 2);
    host.shell.scene.add(anchor);
    rig.jumpTo({ position: new Vector3(4, 3, 8), target: new Vector3(1, 0.5, 2) });
    rig.follow(anchor, 'heading');
    settle();
    const position = rig.camera.position.clone();
    const quaternion = rig.camera.quaternion.clone();
    const target = rig.controls.target.clone();

    host.xr.enter();
    rig.camera.position.set(-5, 7, 1);
    rig.camera.quaternion.copy(new Quaternion(0.3, 0.1, 0.2, 0.9).normalize());
    rig.controls.target.set(9, 9, 9);
    rig.follow(null);
    xrLoop()(1000);
    renderer().setAnimationLoop.mockClear();
    host.xr.exit();

    expect(host.xr.active).toBe(false);
    expect(renderer().setAnimationLoop).toHaveBeenCalledWith(null);
    expect(rig.camera.position.distanceTo(position)).toBeCloseTo(0, 6);
    expect(rig.camera.quaternion.angleTo(quaternion)).toBeCloseTo(0, 6);
    expect(rig.controls.target.distanceTo(target)).toBeCloseTo(0, 6);
    expect(rig.following()).toEqual({ anchor, mode: 'heading' });
    expect(frames.pending()).toBe(1);
    const layout = vi.spyOn(host.shell.labels, 'layout');
    settle();
    expect(layout).toHaveBeenCalled();
  });

  it('ignores exit when not active and a second enter', () => {
    host.xr.exit();
    expect(renderer().setAnimationLoop).not.toHaveBeenCalled();
    host.xr.enter();
    host.xr.enter();
    expect(renderer().setAnimationLoop).toHaveBeenCalledTimes(1);
  });
});
