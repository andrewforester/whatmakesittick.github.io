import { Box3, Group, Vector3 } from 'three';
import type {
  BufferGeometry,
  Color,
  Fog,
  FogExp2,
  InstancedMesh,
  Material,
  Object3D,
  Points,
  PointsMaterial,
  Texture,
} from 'three';
import { UNDIMMED_GROUP } from '../scene/materials';
import type { MaterialLibrary } from '../scene/materials';
import type { SceneShell } from '../scene/shell';

export const AR_MODEL_SIZE = 0.5;

const LABEL_LAYER_SELECTOR = '.scene-label-layer';

export interface ArScene {
  anchor: Group;
  content: Group;
  fitScale: number;
  restore(): void;
}

interface Moved {
  object: Object3D;
  index: number;
}

type Shaped = Object3D & { geometry?: BufferGeometry; material?: Material | Material[] };

function isLight(object: Object3D): boolean {
  return (object as Object3D & { isLight?: boolean }).isLight === true;
}

function isBackdrop(object: Shaped, materials: MaterialLibrary): boolean {
  if (!object.material) return false;
  const list = Array.isArray(object.material) ? object.material : [object.material];
  return list.some((material) => materials.groupOf(material) === UNDIMMED_GROUP);
}

function objectBox(object: Shaped): Box3 | null {
  const instanced = object as InstancedMesh;
  if (instanced.isInstancedMesh) {
    instanced.computeBoundingBox();
    return instanced.boundingBox?.clone().applyMatrix4(object.matrixWorld) ?? null;
  }
  const geometry = object.geometry;
  if (!geometry) return null;
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  return geometry.boundingBox?.clone().applyMatrix4(object.matrixWorld) ?? null;
}

function visibleBox(root: Object3D): Box3 {
  root.updateWorldMatrix(true, true);
  const box = new Box3();
  root.traverseVisible((object) => {
    const part = objectBox(object);
    if (part && !part.isEmpty()) box.union(part);
  });
  return box;
}

function hide(object: Object3D, hidden: Object3D[]): void {
  if (!object.visible) return;
  object.visible = false;
  hidden.push(object);
}

type RenderHook = Object3D['onBeforeRender'];

function isAttenuated(material: Material): material is PointsMaterial {
  return (
    (material as PointsMaterial).isPointsMaterial === true &&
    (material as PointsMaterial).sizeAttenuation
  );
}

function scalePointSizes(content: Object3D): () => void {
  const restores: (() => void)[] = [];
  content.traverse((object) => {
    if (!(object as Points).isPoints) return;
    const before: RenderHook = object.onBeforeRender;
    const after: RenderHook = object.onAfterRender;
    const sizes = new Map<PointsMaterial, number>();
    object.onBeforeRender = function (this: Object3D, ...args: Parameters<RenderHook>) {
      before.apply(this, args);
      const material = args[4];
      if (!isAttenuated(material)) return;
      sizes.set(material, material.size);
      material.size *= content.matrixWorld.getMaxScaleOnAxis();
    };
    object.onAfterRender = function (this: Object3D, ...args: Parameters<RenderHook>) {
      const material = args[4];
      const size = isAttenuated(material) ? sizes.get(material) : undefined;
      if (size !== undefined && isAttenuated(material)) {
        material.size = size;
        sizes.delete(material);
      }
      after.apply(this, args);
    };
    restores.push(() => {
      object.onBeforeRender = before;
      object.onAfterRender = after;
    });
  });
  return () => restores.forEach((restore) => restore());
}

function moveBack(scene: Object3D, content: Object3D, moved: readonly Moved[]): void {
  let skipped = 0;
  [...moved]
    .sort((a, b) => a.index - b.index)
    .forEach(({ object, index }) => {
      if (object.parent !== content) {
        skipped += 1;
        return;
      }
      scene.add(object);
      scene.children.splice(scene.children.indexOf(object), 1);
      scene.children.splice(Math.min(index - skipped, scene.children.length), 0, object);
    });
}

export function prepareArScene(shell: SceneShell): ArScene {
  const { scene, stage, materials, viewport } = shell;
  const background: Color | Texture | null = scene.background;
  const fog: Fog | FogExp2 | null = scene.fog;
  const labelLayer = viewport.element.querySelector<HTMLElement>(LABEL_LAYER_SELECTOR);
  const labelsHidden = labelLayer?.hidden ?? false;
  const hidden: Object3D[] = [];
  const anchor = new Group();
  const content = new Group();
  anchor.add(content);

  const moved: Moved[] = scene.children
    .map((object, index) => ({ object, index }))
    .filter(({ object }) => object !== stage.group && !isLight(object));
  moved.forEach(({ object }) => content.add(object));
  scene.add(anchor);

  hide(stage.group, hidden);
  content.traverse((object) => {
    if (isBackdrop(object, materials)) hide(object, hidden);
  });
  scene.background = null;
  scene.fog = null;
  if (labelLayer) labelLayer.hidden = true;
  const restorePointSizes = scalePointSizes(content);
  let restored = false;

  const box = visibleBox(content);
  const size = box.isEmpty() ? new Vector3() : box.getSize(new Vector3());
  const largest = Math.max(size.x, size.y, size.z);
  const fitScale = largest > 0 ? AR_MODEL_SIZE / largest : 1;
  if (!box.isEmpty()) {
    const base = box.getCenter(new Vector3()).setY(box.min.y);
    content.scale.setScalar(fitScale);
    content.position.copy(base).multiplyScalar(-fitScale);
  }

  return {
    anchor,
    content,
    fitScale,
    restore: () => {
      if (restored) return;
      restored = true;
      anchor.removeFromParent();
      restorePointSizes();
      moveBack(scene, content, moved);
      hidden.forEach((object) => {
        object.visible = true;
      });
      scene.background = background;
      scene.fog = fog;
      if (labelLayer) labelLayer.hidden = labelsHidden;
    },
  };
}
