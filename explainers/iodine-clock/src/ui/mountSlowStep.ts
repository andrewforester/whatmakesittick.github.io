import { disposeAll } from '@core/ui/disposers';
import type { Disposer } from '@core/ui/disposers';
import { mountLiveReadouts } from '@core/ui/liveReadouts';
import { clockReading } from '../state';
import type { ClockStore } from '../state';
import { chapterOf } from './chapters';
import { formatMillimolar } from './format';
import { mountStepList } from './stepList';

export function mountSlowStep(root: Document, store: ClockStore): Disposer {
  const chapter = chapterOf(root, 'slowStep');
  return disposeAll([
    mountStepList(chapter, store),
    mountLiveReadouts(chapter, store, {
      bisulfiteLeft: (state) => formatMillimolar(clockReading(state).bisulfiteM),
      iodideMade: (state) => formatMillimolar(clockReading(state).iodideM),
      acidMade: (state) => formatMillimolar(clockReading(state).acidM),
    }),
  ]);
}
