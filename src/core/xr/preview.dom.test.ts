import {
  Box3,
  BoxGeometry,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  Scene,
  Texture,
  Vector3,
} from 'three';
import { describe, expect, it, vi } from 'vitest';
import { CameraRig } from '../scene/camera';
import { MaterialLibrary } from '../scene/materials';
import type { SceneShell } from '../scene/shell';
import { Stage } from '../scene/stage';
import { AR_MODEL_SIZE } from './arScene';
import { startArPreview } from './preview';

const PAGE_NEAR = 2;
const PAGE_FAR = 5000;
const FLOOR = 0;

interface Fixture {
  shell: SceneShell;
  rig: CameraRig;
  drone: Group;
}

function buildFixture(): Fixture {
  const scene = new Scene();
  scene.background = new Color('#101418');
  const stage = new Stage(new Texture());
  const drone = new Group();
  drone.add(new Mesh(new BoxGeometry(2, 1, 2), new MeshBasicMaterial()));
  scene.add(stage.group, drone);
  const rig = new CameraRig(document.createElement('canvas'), { near: PAGE_NEAR, far: PAGE_FAR });
  rig.setViewport({ width: 400, height: 800, safe: { top: 0, right: 0, bottom: 300, left: 0 } });
  rig.setBounds(new Box3(new Vector3(-1, 0, -1), new Vector3(1, 1, 1)), FLOOR);
  rig.follow(drone, 'heading');
  const shell = {
    scene,
    stage,
    rig,
    materials: new MaterialLibrary(),
    viewport: { element: document.createElement('div') },
    arFocus: () => [],
    invalidate: vi.fn(),
  } as unknown as SceneShell;
  return { shell, rig, drone };
}

describe('startArPreview', () => {
  it('frames the model cube from the front with a near depth range and no floor or follow', () => {
    const { shell, rig } = buildFixture();
    startArPreview(shell);
    const { camera, controls } = rig;
    expect(rig.following().anchor).toBeNull();
    expect([camera.near, camera.far]).toEqual([0.01, 20]);
    expect(controls.target.toArray()).toEqual([0, AR_MODEL_SIZE / 2, 0]);
    expect(camera.position.x).toBeCloseTo(0);
    expect(camera.position.y).toBeGreaterThan(AR_MODEL_SIZE / 2);
    expect(camera.position.z).toBeGreaterThan(AR_MODEL_SIZE);
    rig.update(0);
    expect(controls.target.y).toBeCloseTo(AR_MODEL_SIZE / 2);
  });

  it('puts back the follow anchor, the depth range and the floor on stop', () => {
    const { shell, rig, drone } = buildFixture();
    const stop = startArPreview(shell);
    stop();
    const { camera, controls } = rig;
    expect(rig.following()).toEqual({ anchor: drone, mode: 'heading' });
    expect([camera.near, camera.far]).toEqual([PAGE_NEAR, PAGE_FAR]);
    expect(rig.floor()).toBe(FLOOR);
    controls.target.set(0, FLOOR - 5, 0);
    rig.update(0);
    expect(controls.target.y).toBeGreaterThan(FLOOR);
  });
});
