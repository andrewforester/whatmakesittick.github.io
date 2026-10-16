import './style.css';
import { defineExplainer } from '@core/explainer';
import { SCENE_OPTIONS, mountIodineClockScene } from './scene';
import { PART_INFO } from './scene/partInfo';
import { CHAPTER_CONTROL_DEFAULTS, PRESETS, createClockStore } from './state';
import type { ClockStore, ClockStoreState, RecipeSource } from './state';
import { createClockTimeline } from './timeline';
import { CHAPTER_ACTIONS, CLOCK_CHOICES, CLOCK_READOUTS, VIEW_TOGGLES, mountClockUi } from './ui';

let liveStore: ClockStore | null = null;

function recipe(): RecipeSource {
  return liveStore?.getState() ?? CHAPTER_CONTROL_DEFAULTS;
}

export default defineExplainer<ClockStoreState>({
  id: 'iodine-clock',
  timeline: createClockTimeline(recipe),
  presets: PRESETS,
  parts: PART_INFO,
  createStore: () => (liveStore = createClockStore()),
  dock: { choices: CLOCK_CHOICES, toggles: VIEW_TOGGLES },
  readouts: CLOCK_READOUTS,
  actions: CHAPTER_ACTIONS,
  scene: SCENE_OPTIONS,
  mountScene: mountIodineClockScene,
  mountUi: mountClockUi,
});
