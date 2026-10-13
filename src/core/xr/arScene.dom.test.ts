import {
  Box3,
  BoxGeometry,
  BufferGeometry,
  Color,
  DirectionalLight,
  Fog,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Scene,
  Texture,
  Vector3,
} from 'three';
import type { Camera, Object3D, WebGLRenderer } from 'three';
import { describe, expect, it } from 'vitest';
import { MaterialLibrary, UNDIMMED_GROUP } from '../scene/materials';
import type { SceneShell } from '../scene/shell';
import { Stage } from '../scene/stage';
import { AR_MODEL_SIZE, prepareArScene } from './arScene';

interface Fixture {
  shell: SceneShell;
  mechanism: Mesh;
  backdrop: Mesh;
  light: DirectionalLight;
  points: Points<BufferGeometry, PointsMaterial>;
  labelLayer: HTMLElement;
}

const POINT_SIZE = 2;

function buildFixture(): Fixture {
  const scene = new Scene();
  scene.background = new Color('#101418');
  scene.fog = new Fog('#101418', 10, 100);
  const materials = new MaterialLibrary();
  const stage = new Stage(new Texture());
  const light = new DirectionalLight();
  const mechanism = new Mesh(new BoxGeometry(2, 1, 4), new MeshBasicMaterial());
  mechanism.position.set(0, 3, 0);
  const ground = new MeshBasicMaterial();
  materials.register(UNDIMMED_GROUP, ground);
  const backdrop = new Mesh(new PlaneGeometry(200, 200), [new MeshBasicMaterial(), ground]);
  backdrop.position.set(5, -2, 0);
  const points = new Points(
    new BufferGeometry().setFromPoints([new Vector3(0, 3, 0)]),
    new PointsMaterial({ size: POINT_SIZE, sizeAttenuation: true }),
  );
  scene.add(light, stage.group, mechanism, backdrop, points);
  const element = document.createElement('div');
  const labelLayer = document.createElement('div');
  labelLayer.className = 'scene-label-layer';
  element.append(document.createElement('canvas'), labelLayer);
  const shell = { scene, stage, materials, viewport: { element } } as unknown as SceneShell;
  return { shell, mechanism, backdrop, light, points, labelLayer };
}

interface Snapshot {
  object: Object3D;
  parent: Object3D | null;
  index: number;
  position: Vector3;
  scale: Vector3;
  visible: boolean;
}

function snapshot(scene: Scene): Snapshot[] {
  const result: Snapshot[] = [];
  scene.traverse((object) => {
    if (object === scene) return;
    result.push({
      object,
      parent: object.parent,
      index: object.parent?.children.indexOf(object) ?? -1,
      position: object.position.clone(),
      scale: object.scale.clone(),
      visible: object.visible,
    });
  });
  return result;
}

describe('prepareArScene', () => {
  it('hides the backdrop, stage, fog, background and labels', () => {
    const { shell, backdrop, labelLayer } = buildFixture();
    prepareArScene(shell);
    expect(backdrop.visible).toBe(false);
    expect(shell.stage.group.visible).toBe(false);
    expect(shell.scene.fog).toBeNull();
    expect(shell.scene.background).toBeNull();
    expect(labelLayer.hidden).toBe(true);
  });

  it('keeps lights and the stage in the scene and moves the rest under the anchor', () => {
    const { shell, mechanism, backdrop, light } = buildFixture();
    const ar = prepareArScene(shell);
    expect(light.parent).toBe(shell.scene);
    expect(shell.stage.group.parent).toBe(shell.scene);
    expect(mechanism.parent).toBe(ar.content);
    expect(backdrop.parent).toBe(ar.content);
    expect(ar.content.parent).toBe(ar.anchor);
    expect(ar.anchor.parent).toBe(shell.scene);
  });

  it('fits the mechanism into the model cube with its base at the anchor', () => {
    const { shell } = buildFixture();
    const ar = prepareArScene(shell);
    expect(ar.fitScale).toBeCloseTo(AR_MODEL_SIZE / 4);
    shell.scene.updateMatrixWorld(true);
    const box = new Box3();
    ar.content.traverseVisible((object) => {
      if (object instanceof Mesh) box.expandByObject(object);
    });
    const size = box.getSize(new Vector3());
    expect(Math.max(size.x, size.y, size.z)).toBeCloseTo(AR_MODEL_SIZE);
    const center = box.getCenter(new Vector3());
    expect(center.x).toBeCloseTo(0);
    expect(center.z).toBeCloseTo(0);
    expect(box.min.y).toBeCloseTo(0);
  });

  it('restores the scene as it was', () => {
    const { shell, labelLayer } = buildFixture();
    const before = snapshot(shell.scene);
    const background = shell.scene.background;
    const fog = shell.scene.fog;
    const ar = prepareArScene(shell);
    ar.restore();
    expect(snapshot(shell.scene)).toEqual(before);
    expect(shell.scene.background).toBe(background);
    expect(shell.scene.fog).toBe(fog);
    expect(labelLayer.hidden).toBe(false);
    expect(ar.anchor.parent).toBeNull();
  });

  it('leaves alone what was hidden before', () => {
    const { shell, backdrop, labelLayer } = buildFixture();
    backdrop.visible = false;
    shell.stage.group.visible = false;
    labelLayer.hidden = true;
    const ar = prepareArScene(shell);
    ar.restore();
    expect(backdrop.visible).toBe(false);
    expect(shell.stage.group.visible).toBe(false);
    expect(labelLayer.hidden).toBe(true);
  });

  it('scales point sizes with the model only while a point cloud draws', () => {
    const { shell, points } = buildFixture();
    const ar = prepareArScene(shell);
    shell.scene.updateMatrixWorld(true);
    const renderer = {} as WebGLRenderer;
    const camera = {} as Camera;
    const group = new Group();
    const { geometry, material } = points;
    points.onBeforeRender(renderer, shell.scene, camera, geometry, material, group);
    expect(material.size).toBeCloseTo(POINT_SIZE * ar.fitScale);
    points.onAfterRender(renderer, shell.scene, camera, geometry, material, group);
    expect(material.size).toBe(POINT_SIZE);
  });

  it('puts back the original render hooks', () => {
    const { shell, points } = buildFixture();
    const before = points.onBeforeRender;
    const after = points.onAfterRender;
    const ar = prepareArScene(shell);
    expect(points.onBeforeRender).not.toBe(before);
    ar.restore();
    expect(points.onBeforeRender).toBe(before);
    expect(points.onAfterRender).toBe(after);
  });
});
