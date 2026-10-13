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
  ShaderMaterial,
  Texture,
  Vector3,
} from 'three';
import type { Camera, Object3D, Quaternion, WebGLRenderer } from 'three';
import { describe, expect, it } from 'vitest';
import { MaterialLibrary, STRUCTURE_GROUP, UNDIMMED_GROUP } from '../scene/materials';
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
  focus: Object3D[];
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
  mechanism.rotation.set(0, Math.PI / 2, 0);
  const ground = new MeshBasicMaterial();
  materials.register(UNDIMMED_GROUP, ground);
  const backdrop = new Mesh(new PlaneGeometry(200, 200), [new MeshBasicMaterial(), ground]);
  backdrop.position.set(5, -2, 0);
  const points = new Points(
    new BufferGeometry().setFromPoints([new Vector3(0, 1.5, 0)]),
    new PointsMaterial({ size: POINT_SIZE, sizeAttenuation: true }),
  );
  points.scale.setScalar(2);
  scene.add(light, stage.group, mechanism, backdrop, points);
  const element = document.createElement('div');
  const labelLayer = document.createElement('div');
  labelLayer.className = 'scene-label-layer';
  element.append(document.createElement('canvas'), labelLayer);
  const focus: Object3D[] = [];
  const shell = {
    scene,
    stage,
    materials,
    viewport: { element },
    arFocus: () => focus,
  } as unknown as SceneShell;
  return { shell, mechanism, backdrop, light, points, labelLayer, focus };
}

interface Snapshot {
  object: Object3D;
  parent: Object3D | null;
  index: number;
  position: Vector3;
  scale: Vector3;
  quaternion: Quaternion;
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
      quaternion: object.quaternion.clone(),
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

  it('fits the solid parts and leaves out shader ground, point clouds and faint volumes', () => {
    const { shell } = buildFixture();
    const groundMaterial = new ShaderMaterial();
    shell.materials.register(STRUCTURE_GROUP, groundMaterial);
    const ground = new Mesh(new PlaneGeometry(100, 100), groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    const cloud = new Points(
      new BufferGeometry().setFromPoints([new Vector3(-50, 0, -50), new Vector3(50, 40, 50)]),
      new PointsMaterial(),
    );
    const volume = new Mesh(
      new BoxGeometry(60, 60, 60),
      new MeshBasicMaterial({ transparent: true, opacity: 0.3 }),
    );
    shell.scene.add(ground, cloud, volume);
    const ar = prepareArScene(shell);
    expect(ar.fitScale).toBeCloseTo(AR_MODEL_SIZE / 4);
  });

  it('fits the focus alone when the explainer names one', () => {
    const { shell, mechanism, focus } = buildFixture();
    const ship = new Mesh(new BoxGeometry(30, 30, 30), new MeshBasicMaterial());
    ship.position.set(200, 0, 0);
    shell.scene.add(ship);
    focus.push(mechanism);
    const ar = prepareArScene(shell);
    expect(ar.fitScale).toBeCloseTo(AR_MODEL_SIZE / 4);
    shell.scene.updateMatrixWorld(true);
    const box = new Box3().setFromObject(mechanism);
    expect(Math.max(...box.getSize(new Vector3()).toArray())).toBeCloseTo(AR_MODEL_SIZE);
    expect(box.min.y).toBeCloseTo(0);
    expect(box.getCenter(new Vector3()).x).toBeCloseTo(0);
  });

  it('fits the whole focus when it has no solid parts', () => {
    const { shell, points, focus } = buildFixture();
    const cloud = new Points(
      new BufferGeometry().setFromPoints([new Vector3(0, 0, 0), new Vector3(10, 0, 0)]),
      new PointsMaterial(),
    );
    shell.scene.add(cloud);
    focus.push(cloud);
    const ar = prepareArScene(shell);
    expect(ar.fitScale).toBeCloseTo(AR_MODEL_SIZE / 10);
    expect(points.visible).toBe(false);
  });

  it('hides every mesh outside the focus and keeps only effects close to it', () => {
    const { shell, mechanism, focus } = buildFixture();
    const pier = new Mesh(new BoxGeometry(0.5, 0.5, 0.5), new MeshBasicMaterial());
    pier.position.set(2.6, 3, 0);
    const spray = new Points(
      new BufferGeometry().setFromPoints([new Vector3(2.2, 3, 0)]),
      new PointsMaterial(),
    );
    const cloud = new Points(
      new BufferGeometry().setFromPoints([new Vector3(50, 3, 0)]),
      new PointsMaterial(),
    );
    shell.scene.add(pier, spray, cloud);
    focus.push(mechanism);
    const ar = prepareArScene(shell);
    expect(pier.visible).toBe(false);
    expect(cloud.visible).toBe(false);
    expect(spray.visible).toBe(true);
    expect(mechanism.visible).toBe(true);
    ar.restore();
    expect(pier.visible).toBe(true);
    expect(cloud.visible).toBe(true);
    expect(spray.visible).toBe(true);
  });

  it('keeps a mesh that holds an effect it keeps', () => {
    const { shell, mechanism, focus } = buildFixture();
    const hull = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
    hull.position.set(50, 3, 0);
    const wake = new Points(
      new BufferGeometry().setFromPoints([new Vector3(-48, 0, 0)]),
      new PointsMaterial(),
    );
    hull.add(wake);
    shell.scene.add(hull);
    focus.push(mechanism);
    prepareArScene(shell);
    expect(wake.visible).toBe(true);
    expect(hull.visible).toBe(true);
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

  it('leaves out what was taken out of the content during the session', () => {
    const { shell, mechanism, backdrop, points, light } = buildFixture();
    const ar = prepareArScene(shell);
    mechanism.removeFromParent();
    ar.restore();
    expect(mechanism.parent).toBeNull();
    expect(shell.scene.children).toEqual([light, shell.stage.group, backdrop, points]);
  });

  it('does nothing on a second restore', () => {
    const { shell, mechanism } = buildFixture();
    const ar = prepareArScene(shell);
    ar.restore();
    const before = snapshot(shell.scene);
    shell.scene.background = null;
    mechanism.visible = false;
    ar.restore();
    expect(shell.scene.background).toBeNull();
    mechanism.visible = true;
    expect(snapshot(shell.scene)).toEqual(before);
  });
});
