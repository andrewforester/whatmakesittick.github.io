import './ar.css';
import type { SceneHost } from '../scene/shell';
import { requireElement } from '../ui/dom';
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

export async function enterAr(host: SceneHost, stage: HTMLElement): Promise<void> {
  if (host.xr.active) return;
  const message = requireElement(stage, MESSAGE_SELECTOR);
  hideMessage(message);
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
