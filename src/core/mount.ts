import './style.css';
import './scene/scene.css';
import type { Explainer, ExplainerStore, Playback } from './explainer';
import { initI18n, shippedLanguages } from './i18n';
import type { LocaleLoaders } from './i18n';
import { createSceneHost } from './scene/shell';
import type { SceneHost } from './scene/shell';
import { mountActions } from './ui/actions';
import { mountSiteLinks } from './ui/siteLinks';
import { mountDock } from './ui/dock';
import { requireElement } from './ui/dom';
import { mountFooter } from './ui/footer';
import { mountKeyboard } from './ui/keyboard';
import { mountLanguage } from './ui/language';
import { respectReducedMotion } from './ui/motion';
import { mountReadouts } from './ui/readouts';
import { mountSafeArea } from './ui/safeArea';
import { mountSections } from './ui/sections';
import { mountStageExpansion, stageShortcuts } from './ui/stageExpansion';
import { mountArButton } from './xr/button';
import { isArSupported } from './xr/support';

const SITE_NAME_KEY = 'catalogue.title';
const SCENE_SELECTOR = '#scene';
const STAGE_SELECTOR = '[data-stage]';

interface MountedScene {
  host: SceneHost;
  unmount: () => void;
}

function mountScene<S extends Playback>(
  root: Document,
  store: ExplainerStore<S>,
  explainer: Explainer<S>,
): MountedScene {
  const host = createSceneHost(
    requireElement(root, SCENE_SELECTOR),
    explainer.parts,
    explainer.scene,
  );
  const unmount = explainer.mountScene(host.shell, store);
  host.start(store);
  if (import.meta.env.DEV && new URLSearchParams(location.search).has('ar-preview')) {
    void import('./xr/preview').then(({ startArPreview }) => startArPreview(host.shell));
  }
  return {
    host,
    unmount: () => {
      unmount();
      host.dispose();
    },
  };
}

function mountAr(root: Document, host: SceneHost, enabled: boolean): () => void {
  const element = requireElement(root, STAGE_SELECTOR);
  let starting = false;
  return mountArButton(root, {
    enabled,
    supported: isArSupported,
    onEnter: () => {
      if (starting) return;
      starting = true;
      import('./xr/enter')
        .then(({ enterAr }) => enterAr(host, element))
        .catch(() => {})
        .finally(() => {
          starting = false;
        });
    },
  });
}

export async function mountExplainer<S extends Playback>(
  explainer: Explainer<S>,
  locales: LocaleLoaders,
): Promise<() => void> {
  await initI18n(locales);
  const languages = shippedLanguages(locales);
  const store = explainer.createStore();
  respectReducedMotion(store);
  mountDock(document, store, explainer);
  mountReadouts(document, store, explainer.readouts);
  mountLanguage(document, languages);
  mountSiteLinks(document);
  mountFooter(document, SITE_NAME_KEY);
  explainer.mountUi?.(document, store);
  mountActions(document, store, explainer.actions);
  const stage = mountStageExpansion(document);
  const unmountKeyboard = mountKeyboard(document, store, explainer, stageShortcuts(stage));
  mountSections(document, store, Object.keys(explainer.presets), stage);
  mountSafeArea(document, explainer.scene?.gaugeSide);
  const scene = mountScene(document, store, explainer);
  const unmountAr = mountAr(document, scene.host, explainer.scene?.ar !== false);
  return () => {
    unmountAr();
    scene.unmount();
    unmountKeyboard();
    stage.dispose();
  };
}
