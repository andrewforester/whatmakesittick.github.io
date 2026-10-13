import './ar.css';
import type { SceneHost } from '../scene/shell';
import { requireElement } from '../ui/dom';
import type { StageExpansion } from '../ui/stageExpansion';
import { startArSession, writeCopy } from './session';

const MESSAGE_SELECTOR = '[data-ar-message]';
const FAILED_KEY = 'ar.failed';
const MESSAGE_MS = 4000;

let messageTimer: ReturnType<typeof setTimeout> | undefined;

function hideMessage(message: HTMLElement): void {
  clearTimeout(messageTimer);
  messageTimer = undefined;
  message.hidden = true;
}

function showFailure(message: HTMLElement): void {
  writeCopy(message, FAILED_KEY);
  message.hidden = false;
  clearTimeout(messageTimer);
  messageTimer = setTimeout(() => hideMessage(message), MESSAGE_MS);
}

function collapse(expansion: StageExpansion): Promise<void> {
  if (!expansion.expanded) return Promise.resolve();
  return new Promise((resolve) => {
    const stop = expansion.onChange((expanded) => {
      if (expanded) return;
      stop();
      resolve();
    });
    expansion.collapse();
  });
}

export async function enterAr(
  host: SceneHost,
  stage: HTMLElement,
  expansion: StageExpansion,
): Promise<void> {
  if (host.xr.active) return;
  const message = requireElement(stage, MESSAGE_SELECTOR);
  hideMessage(message);
  await collapse(expansion);
  const xr = navigator.xr;
  if (!xr) {
    showFailure(message);
    return;
  }
  try {
    await startArSession(host, stage, xr);
  } catch {
    showFailure(message);
  }
}
