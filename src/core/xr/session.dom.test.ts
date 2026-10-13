import { Group, Matrix4, Scene } from 'three';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n, t } from '../i18n';
import type { FrameUpdate, SceneHost } from '../scene/shell';
import type { StageExpansion } from '../ui/stageExpansion';
import { prepareArScene } from './arScene';
import type { ArScene } from './arScene';
import { enterAr } from './enter';
import { startArSession } from './session';

vi.mock('./arScene', () => ({ prepareArScene: vi.fn() }));

const PAGE = `
  <section class="stage" data-stage>
    <div id="scene"></div>
    <aside class="gauge glass" data-gauge></aside>
    <div class="dock glass" data-dock><button type="button" data-control="play"></button></div>
    <div class="ar-ui" data-ar-ui hidden>
      <p class="ar-hint glass" data-ar-hint role="status"></p>
      <button type="button" class="ar-exit glass" data-control="ar-exit"></button>
    </div>
    <p class="ar-message" data-ar-message role="status" hidden></p>
  </section>
`;

const FIT_SCALE = 0.1;
const HIT = { x: 0.4, y: 0, z: -1.2 };

class FakeXrManager extends EventTarget {
  enabled = false;
  frame: XRFrame | null = null;
  readonly setSession = vi.fn(() => Promise.resolve());
  readonly setReferenceSpaceType = vi.fn();
  readonly getReferenceSpace = vi.fn(() => ({}) as XRReferenceSpace);
  readonly getFrame = vi.fn(() => this.frame);
}

class FakeSession extends EventTarget {
  readonly enabledFeatures = ['hit-test', 'dom-overlay', 'local-floor'];
  readonly viewerSource = { cancel: vi.fn() };
  readonly touchSource = { cancel: vi.fn() };
  readonly requestReferenceSpace = vi.fn(() => Promise.resolve({} as XRReferenceSpace));
  readonly requestHitTestSource = vi.fn(() => Promise.resolve(this.viewerSource));
  readonly requestHitTestSourceForTransientInput = vi.fn(() => Promise.resolve(this.touchSource));
  readonly end = vi.fn(() => {
    this.manager.dispatchEvent(new Event('sessionend'));
    return Promise.resolve();
  });

  private readonly manager: FakeXrManager;

  constructor(manager: FakeXrManager) {
    super();
    this.manager = manager;
  }
}

interface Fixture {
  host: SceneHost;
  manager: FakeXrManager;
  session: FakeSession;
  system: XRSystem;
  requestSession: ReturnType<typeof vi.fn>;
  controls: { enabled: boolean };
  frames: Set<FrameUpdate>;
  scene: Scene;
  arScene: ArScene;
  restore: ReturnType<typeof vi.fn>;
}

function hitResult(at: typeof HIT): XRHitTestResult {
  const matrix = new Matrix4().makeTranslation(at.x, at.y, at.z).toArray();
  return { getPose: () => ({ transform: { matrix } }) } as unknown as XRHitTestResult;
}

function frameWith(
  hits: XRHitTestResult[],
  touches: { inputSource: XRInputSource; results: XRHitTestResult[] }[] = [],
): XRFrame {
  return {
    getHitTestResults: () => hits,
    getHitTestResultsForTransientInput: () => touches,
    getViewerPose: () => undefined,
  } as unknown as XRFrame;
}

function fakeExpansion(expanded: boolean): StageExpansion {
  const listeners = new Set<(expanded: boolean) => void>();
  let isExpanded = expanded;
  return {
    get expanded() {
      return isExpanded;
    },
    toggle: vi.fn(),
    collapse: vi.fn(() => {
      setTimeout(() => {
        isExpanded = false;
        listeners.forEach((listener) => listener(false));
      }, 0);
    }),
    onChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose: vi.fn(),
  };
}

function buildFixture(reject = false): Fixture {
  const manager = new FakeXrManager();
  const session = new FakeSession(manager);
  const requestSession = vi.fn(() =>
    reject ? Promise.reject(new Error('denied')) : Promise.resolve(session),
  );
  const system = { requestSession } as unknown as XRSystem;
  const controls = { enabled: true };
  const frames = new Set<FrameUpdate>();
  const scene = new Scene();
  const restore = vi.fn();
  const arScene: ArScene = {
    anchor: new Group(),
    content: new Group(),
    fitScale: FIT_SCALE,
    restore,
  };
  scene.add(arScene.anchor);
  vi.mocked(prepareArScene).mockReturnValue(arScene);
  const host = {
    shell: {
      scene,
      rig: { controls },
      viewport: { renderer: { xr: manager } },
      onFrame: (update: FrameUpdate) => {
        frames.add(update);
        return () => frames.delete(update);
      },
      invalidate: vi.fn(),
    },
    xr: { enter: vi.fn(), exit: vi.fn(), active: false },
    start: vi.fn(),
    dispose: vi.fn(),
  } as unknown as SceneHost;
  return {
    host,
    manager,
    session,
    system,
    requestSession,
    controls,
    frames,
    scene,
    arScene,
    restore,
  };
}

function stage(): HTMLElement {
  return element('[data-stage]');
}

function element<T extends HTMLElement = HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`No ${selector}`);
  return found;
}

function runFrame(fixture: Fixture, frame: XRFrame): void {
  fixture.manager.frame = frame;
  fixture.frames.forEach((update) => update(0));
}

function inputEvent(type: string, inputSource: XRInputSource): Event {
  return Object.assign(new Event(type), { inputSource });
}

function pointer(type: string, pointerId: number, x: number, y: number, target?: Element): void {
  const event = new PointerEvent(type, { pointerId, clientX: x, clientY: y, bubbles: true });
  (target ?? stage()).dispatchEvent(event);
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function started(): Promise<Fixture> {
  const fixture = buildFixture();
  await startArSession(fixture.host, stage(), fixture.system);
  await settle();
  return fixture;
}

async function placed(): Promise<Fixture> {
  const fixture = await started();
  runFrame(fixture, frameWith([hitResult(HIT)]));
  fixture.session.dispatchEvent(inputEvent('select', {} as XRInputSource));
  return fixture;
}

function expectTornDown(fixture: Fixture): void {
  expect(fixture.restore).toHaveBeenCalledOnce();
  expect(fixture.host.xr.exit).toHaveBeenCalledOnce();
  expect(fixture.manager.enabled).toBe(false);
  expect(fixture.controls.enabled).toBe(true);
  expect(stage().hasAttribute('data-ar')).toBe(false);
  expect(element('[data-ar-ui]').hidden).toBe(true);
  expect(fixture.frames.size).toBe(0);
  expect(fixture.session.viewerSource.cancel).toHaveBeenCalled();
}

describe('AR session', () => {
  beforeAll(async () => {
    await initI18n();
  });

  beforeEach(() => {
    document.body.innerHTML = PAGE;
    vi.mocked(prepareArScene).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    Reflect.deleteProperty(navigator, 'xr');
  });

  it('leaves the scene alone and shows a short message when the session is refused', async () => {
    vi.useFakeTimers();
    const fixture = buildFixture(true);
    Object.defineProperty(navigator, 'xr', { value: fixture.system, configurable: true });
    await enterAr(fixture.host, stage(), fakeExpansion(false));
    const message = element('[data-ar-message]');
    expect(fixture.host.xr.enter).not.toHaveBeenCalled();
    expect(prepareArScene).not.toHaveBeenCalled();
    expect(fixture.manager.enabled).toBe(false);
    expect(stage().hasAttribute('data-ar')).toBe(false);
    expect(message.hidden).toBe(false);
    expect(message.textContent).toBe(t('ar.failed'));
    vi.advanceTimersByTime(4000);
    expect(message.hidden).toBe(true);
  });

  it('asks for an AR session with the stage as the overlay', async () => {
    const fixture = await started();
    expect(fixture.requestSession).toHaveBeenCalledWith('immersive-ar', {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['dom-overlay', 'local-floor'],
      domOverlay: { root: stage() },
    });
    expect(fixture.manager.setReferenceSpaceType).toHaveBeenCalledWith('local-floor');
  });

  it('hands the scene to the session and shows the overlay', async () => {
    const fixture = await started();
    expect(fixture.manager.enabled).toBe(true);
    expect(fixture.manager.setSession).toHaveBeenCalledWith(fixture.session);
    expect(fixture.host.xr.enter).toHaveBeenCalledOnce();
    expect(fixture.controls.enabled).toBe(false);
    expect(stage().hasAttribute('data-ar')).toBe(true);
    expect(element('[data-ar-ui]').hidden).toBe(false);
    expect(element('[data-ar-hint]').textContent).toBe(t('ar.find'));
    expect(fixture.arScene.anchor.visible).toBe(false);
  });

  it('falls back to a local space when the floor is not granted', async () => {
    const fixture = buildFixture();
    Object.defineProperty(fixture.session, 'enabledFeatures', { value: ['hit-test'] });
    await startArSession(fixture.host, stage(), fixture.system);
    expect(fixture.manager.setReferenceSpaceType).toHaveBeenCalledWith('local');
  });

  it('shows the reticle on a surface and places the model on a tap', async () => {
    const fixture = await started();
    vi.useFakeTimers();
    runFrame(fixture, frameWith([]));
    const reticle = fixture.scene.children.find((child) => child !== fixture.arScene.anchor);
    expect(reticle?.visible).toBe(false);
    runFrame(fixture, frameWith([hitResult(HIT)]));
    expect(reticle?.visible).toBe(true);
    expect(element('[data-ar-hint]').textContent).toBe(t('ar.place'));
    fixture.session.dispatchEvent(inputEvent('select', {} as XRInputSource));
    const { anchor } = fixture.arScene;
    expect(anchor.visible).toBe(true);
    expect(anchor.position.toArray()).toEqual([HIT.x, HIT.y, HIT.z]);
    expect(reticle?.visible).toBe(false);
    const hint = element('[data-ar-hint]');
    expect(hint.textContent).toBe(t('ar.gestures'));
    expect(hint.hasAttribute('data-faded')).toBe(false);
    vi.advanceTimersByTime(3000);
    expect(hint.hasAttribute('data-faded')).toBe(true);
  });

  it('drags the placed model with one finger without a jump', async () => {
    const fixture = await placed();
    const input = {} as XRInputSource;
    const { anchor } = fixture.arScene;
    const touch = (at: typeof HIT) =>
      frameWith([], [{ inputSource: input, results: [hitResult(at)] }]);
    fixture.session.dispatchEvent(inputEvent('selectstart', input));
    runFrame(fixture, touch({ x: 0.5, y: 0, z: -1.2 }));
    expect(anchor.position.x).toBeCloseTo(HIT.x);
    runFrame(fixture, touch({ x: 0.8, y: 0, z: -1 }));
    expect(anchor.position.x).toBeCloseTo(HIT.x + 0.3);
    expect(anchor.position.z).toBeCloseTo(HIT.z + 0.2);
    fixture.session.dispatchEvent(inputEvent('selectend', input));
    runFrame(fixture, touch({ x: 2, y: 0, z: 0 }));
    expect(anchor.position.x).toBeCloseTo(HIT.x + 0.3);
  });

  it('pinches to scale within the limits and twists to turn', async () => {
    const fixture = await placed();
    const { anchor } = fixture.arScene;
    pointer('pointerdown', 1, 100, 100);
    pointer('pointerdown', 2, 200, 100);
    pointer('pointermove', 2, 300, 100);
    expect(anchor.scale.x).toBeCloseTo(2);
    pointer('pointermove', 2, 100, 300);
    expect(anchor.scale.x).toBeCloseTo(2);
    expect(anchor.rotation.y).toBeCloseTo(-Math.PI / 2);
    pointer('pointermove', 2, 10000, 100);
    expect(anchor.scale.x).toBe(4);
    pointer('pointerup', 2, 10000, 100);
    pointer('pointermove', 1, 0, 0);
    expect(anchor.scale.x).toBe(4);
  });

  it('keeps the scale when two fingers start on the same spot', async () => {
    const fixture = await placed();
    const { anchor } = fixture.arScene;
    pointer('pointerdown', 1, 100, 100);
    pointer('pointerdown', 2, 100, 100);
    pointer('pointermove', 2, 300, 100);
    expect(anchor.scale.x).toBe(1);
  });

  it('ignores fingers on the dock', async () => {
    const fixture = await placed();
    const play = element('[data-control="play"]');
    pointer('pointerdown', 1, 100, 100, play);
    pointer('pointerdown', 2, 200, 100);
    pointer('pointermove', 2, 300, 100);
    expect(fixture.arScene.anchor.scale.x).toBe(1);
  });

  it('restores the page when the session ends from the system', async () => {
    const fixture = await started();
    fixture.manager.dispatchEvent(new Event('sessionend'));
    expectTornDown(fixture);
    expect(fixture.scene.children).toEqual([fixture.arScene.anchor]);
  });

  it('ends the session from the exit button and restores the page', async () => {
    const fixture = await started();
    element('[data-control="ar-exit"]').click();
    expect(fixture.session.end).toHaveBeenCalledOnce();
    expectTornDown(fixture);
  });

  it('keeps taps on the dock and the gauge from reaching the session', async () => {
    await started();
    ['[data-dock]', '[data-gauge]'].forEach((selector) => {
      const event = new Event('beforexrselect', { bubbles: true, cancelable: true });
      element(selector).dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    });
  });

  it('tears down what it started when the session cannot be set', async () => {
    const fixture = buildFixture();
    fixture.manager.setSession.mockRejectedValueOnce(new Error('broken'));
    await expect(startArSession(fixture.host, stage(), fixture.system)).rejects.toThrow('broken');
    expect(fixture.manager.enabled).toBe(false);
    expect(fixture.host.xr.enter).not.toHaveBeenCalled();
    expect(fixture.session.end).toHaveBeenCalled();
    expect(stage().hasAttribute('data-ar')).toBe(false);
  });

  it('collapses the expanded stage before it asks for a session', async () => {
    const fixture = buildFixture();
    Object.defineProperty(navigator, 'xr', { value: fixture.system, configurable: true });
    const expansion = fakeExpansion(true);
    await enterAr(fixture.host, stage(), expansion);
    const [collapsed] = vi.mocked(expansion.collapse).mock.invocationCallOrder;
    const [requested] = fixture.requestSession.mock.invocationCallOrder;
    expect(expansion.expanded).toBe(false);
    expect(collapsed).toBeLessThan(requested ?? 0);
    expect(fixture.host.xr.enter).toHaveBeenCalledOnce();
  });

  it('restores the page, ends the session and says so when the viewer space is refused', async () => {
    const fixture = buildFixture();
    fixture.session.requestReferenceSpace.mockRejectedValueOnce(new Error('no viewer'));
    Object.defineProperty(navigator, 'xr', { value: fixture.system, configurable: true });
    await enterAr(fixture.host, stage(), fakeExpansion(false));
    expect(fixture.session.end).toHaveBeenCalled();
    expect(fixture.host.xr.enter).not.toHaveBeenCalled();
    expect(fixture.manager.enabled).toBe(false);
    expect(fixture.controls.enabled).toBe(true);
    expect(stage().hasAttribute('data-ar')).toBe(false);
    expect(element('[data-ar-ui]').hidden).toBe(true);
    const message = element('[data-ar-message]');
    expect(message.hidden).toBe(false);
    expect(message.textContent).toBe(t('ar.failed'));
  });

  it('stops the one finger drag while two inputs are down', async () => {
    const fixture = await placed();
    const first = {} as XRInputSource;
    const second = {} as XRInputSource;
    const { anchor } = fixture.arScene;
    const touch = (at: typeof HIT) =>
      frameWith([], [{ inputSource: first, results: [hitResult(at)] }]);
    fixture.session.dispatchEvent(inputEvent('selectstart', first));
    fixture.session.dispatchEvent(inputEvent('selectstart', second));
    runFrame(fixture, touch({ x: 0.5, y: 0, z: -1.2 }));
    runFrame(fixture, touch({ x: 2, y: 0, z: 1 }));
    expect(anchor.position.toArray()).toEqual([HIT.x, HIT.y, HIT.z]);
  });

  it('keeps a tap on the exit button from reaching the session', async () => {
    await started();
    const event = new Event('beforexrselect', { bubbles: true, cancelable: true });
    element('[data-control="ar-exit"]').dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});
