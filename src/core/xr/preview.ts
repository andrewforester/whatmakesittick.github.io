import { Color, Vector3 } from 'three';
import type { SceneShell } from '../scene/shell';
import { AR_MODEL_SIZE, prepareArScene } from './arScene';

const PREVIEW_BACKGROUND = '#8a8f96';
const PREVIEW_TARGET = new Vector3(0, AR_MODEL_SIZE / 2, 0);
const PREVIEW_OFFSET = new Vector3(0.75, 0.5, 1.05);
const PREVIEW_DISTANCE = { min: AR_MODEL_SIZE / 2, max: AR_MODEL_SIZE * 10 };

export function startArPreview(shell: SceneShell): () => void {
  const ar = prepareArScene(shell);
  shell.scene.background = new Color(PREVIEW_BACKGROUND);
  shell.scene.fog = null;
  shell.rig.setDistanceLimits(PREVIEW_DISTANCE);
  shell.rig.jumpTo({
    position: PREVIEW_TARGET.clone().add(PREVIEW_OFFSET),
    target: PREVIEW_TARGET.clone(),
  });
  shell.invalidate();
  return () => {
    ar.restore();
    shell.rig.setDistanceLimits({});
    shell.invalidate();
  };
}
