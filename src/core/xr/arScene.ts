import { Box3, Group, Vector3 } from 'three';
import type {
  BufferGeometry,
  Color,
  Fog,
  FogExp2,
  InstancedMesh,
  Material,
  Mesh,
  Object3D,
  Points,
  PointsMaterial,
  ShaderMaterial,
  Texture,
} from 'three';
import { UNDIMMED_GROUP } from '../scene/materials';
import type { MaterialLibrary } from '../scene/materials';
import type { SceneShell } from '../scene/shell';

export const AR_MODEL_SIZE = 0.5;

const LABEL_LAYER_SELECTOR = '.scene-label-layer';
const SOLID_OPACITY = 0.5;
const FOCUS_MARGIN = 0.1;
const HIDDEN_LAYER = 31;

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

function isSolidMaterial(material: Material): boolean {
  if ((material as ShaderMaterial).isShaderMaterial) return false;
  return !material.transparent || material.opacity >= SOLID_OPACITY;
}

function isSolid(object: Shaped): boolean {
  if (!(object as Mesh).isMesh || !object.material) return false;
  const list = Array.isArray(object.material) ? object.material : [object.material];
  return list.some(isSolidMaterial);
}

function isLayerHidden(object: Object3D): boolean {
  return object.layers.isEnabled(HIDDEN_LAYER);
}

function unionBox(roots: readonly Object3D[], counts: (object: Object3D) => boolean): Box3 {
  const box = new Box3();
  roots.forEach((root) =>
    root.traverseVisible((object) => {
      if (isLayerHidden(object) || !counts(object)) return;
      const part = objectBox(object);
      if (part && !part.isEmpty()) box.union(part);
    }),
  );
  return box;
}

function fitBox(roots: readonly Object3D[]): Box3 {
  const solid = unionBox(roots, isSolid);
  return solid.isEmpty() ? unionBox(roots, () => true) : solid;
}

type Drawn = Object3D & {
  isMesh?: boolean;
  isPoints?: boolean;
  isLine?: boolean;
  isSprite?: boolean;
  isLineSegments2?: boolean;
};

function isDrawn(object: Drawn): boolean {
  return (
    object.isMesh === true ||
    object.isPoints === true ||
    object.isLine === true ||
    object.isSprite === true
  );
}

function isWithin(object: Object3D, root: Object3D): boolean {
  for (let node: Object3D | null = object; node; node = node.parent) {
    if (node === root) return true;
  }
  return false;
}

function isSolidShape(object: Drawn): boolean {
  return object.isMesh === true && object.isLineSegments2 !== true;
}

function missesBox(object: Object3D, box: Box3): boolean {
  const part = objectBox(object);
  return part !== null && !part.intersectsBox(box);
}

function outsideFocus(content: Object3D, focus: readonly Object3D[], box: Box3): Object3D[] {
  const largest = Math.max(...box.getSize(new Vector3()).toArray());
  const near = box.clone().expandByScalar(largest * FOCUS_MARGIN);
  const outside = new Set<Object3D>();
  const kept: Object3D[] = [];
  content.traverseVisible((object) => {
    if (!isDrawn(object) || isLayerHidden(object)) return;
    if (focus.some((root) => isWithin(object, root) || isWithin(root, object))) {
      kept.push(object);
      return;
    }
    if (isSolidShape(object) || missesBox(object, near)) outside.add(object);
    else kept.push(object);
  });
  kept.forEach((object) => {
    for (let node = object.parent; node && node !== content; node = node.parent) {
      outside.delete(node);
    }
  });
  return [...outside];
}

function hide(root: Object3D, masks: Map<Object3D, number>): void {
  root.traverse((object) => {
    if (!isDrawn(object) || masks.has(object)) return;
    masks.set(object, object.layers.mask);
    object.layers.set(HIDDEN_LAYER);
  });
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
  const hidden = new Map<Object3D, number>();
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

  content.updateWorldMatrix(true, true);
  const focus = shell.arFocus().filter((object) => isWithin(object, content));
  const box = fitBox(focus.length > 0 ? focus : [content]);
  if (focus.length > 0 && !box.isEmpty()) {
    outsideFocus(content, focus, box).forEach((object) => hide(object, hidden));
  }
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
      hidden.forEach((mask, object) => {
        object.layers.mask = mask;
      });
      scene.background = background;
      scene.fog = fog;
      if (labelLayer) labelLayer.hidden = labelsHidden;
    },
  };
}
