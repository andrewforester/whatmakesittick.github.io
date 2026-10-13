import { Box3, Color, Vector3 } from 'three';
import { frameBox } from '../scene/frameBox';
import type { SceneShell } from '../scene/shell';
import { AR_MODEL_SIZE, prepareArScene } from './arScene';
import { setArDepth } from './depth';

const PREVIEW_BACKGROUND = '#8a8f96';
const HALF = AR_MODEL_SIZE / 2;
const PREVIEW_CUBE = new Box3(new Vector3(-HALF, 0, -HALF), new Vector3(HALF, AR_MODEL_SIZE, HALF));
const PREVIEW_DIRECTION = new Vector3(0, 0.35, 1).normalize();
const PREVIEW_MARGIN = 1.2;
const PREVIEW_DISTANCE = { min: AR_MODEL_SIZE / 2, max: AR_MODEL_SIZE * 10 };

export function startArPreview(shell: SceneShell): () => void {
  const { rig } = shell;
  const ar = prepareArScene(shell);
  const follow = rig.following();
  const floor = rig.floor();
  const restoreDepth = setArDepth(rig.camera);
  rig.follow(null);
  rig.setFloor(-Infinity);
  shell.scene.background = new Color(PREVIEW_BACKGROUND);
  shell.scene.fog = null;
  rig.setDistanceLimits(PREVIEW_DISTANCE);
  rig.jumpTo(frameBox(PREVIEW_CUBE, PREVIEW_DIRECTION, rig.framing(), PREVIEW_MARGIN));
  shell.invalidate();
  return () => {
    ar.restore();
    restoreDepth();
    rig.setFloor(floor);
    rig.follow(follow.anchor, follow.mode);
    rig.setDistanceLimits({});
    shell.invalidate();
  };
}
