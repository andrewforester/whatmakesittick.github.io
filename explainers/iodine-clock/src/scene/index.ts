import { UNDIMMED_GROUP } from '@core/scene/materials';
import { createLabelVisibility } from '@core/scene/presetBinder';
import type { SceneOptions, SceneShell } from '@core/scene/shell';
import type { ClockStore } from '../state';
import { THEME } from '../theme';
import { bindStore } from './bindings';
import { ClockController } from './controller';
import { LABEL_PRIORITY, UNDIMMED_PARTS } from './partInfo';

export { bindStore } from './bindings';
export type { SceneTargets } from './bindings';
export { ClockController } from './controller';
export type { ClockControllerDependencies, ViewFramer } from './controller';

const CAMERA_NEAR = 0.1;
const CAMERA_FAR = 2000;
const MAX_POLAR_SHARE = 0.85;
const MIN_DISTANCE = 8;
const MAX_DISTANCE = 300;

export const SCENE_OPTIONS: SceneOptions = {
  background: THEME.sceneBackground,
  stage: false,
  camera: {
    near: CAMERA_NEAR,
    far: CAMERA_FAR,
    maxPolarAngle: Math.PI * MAX_POLAR_SHARE,
    distance: { min: MIN_DISTANCE, max: MAX_DISTANCE },
  },
  gaugeSide: 'right',
  highlight: { undimmed: [UNDIMMED_GROUP, ...UNDIMMED_PARTS] },
};

export function mountIodineClockScene(shell: SceneShell, store: ClockStore): () => void {
  const clock = new ClockController(shell);
  const removeFrame = shell.onFrame((deltaSeconds) => clock.update(deltaSeconds));
  const labelVisibility = createLabelVisibility(shell, LABEL_PRIORITY);
  const unbind = bindStore(store, { clock, labelVisibility, ...shell });
  return () => {
    removeFrame();
    labelVisibility.dispose();
    unbind();
    clock.dispose();
  };
}
