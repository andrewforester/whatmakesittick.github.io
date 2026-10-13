import { requireElement } from '../ui/dom';

export interface ArButtonOptions {
  enabled: boolean;
  supported: () => Promise<boolean>;
  onEnter: () => void;
}

const BUTTON_SELECTOR = '[data-control="ar"]';

export function mountArButton(root: Document, options: ArButtonOptions): () => void {
  const button = requireElement<HTMLButtonElement>(root, BUTTON_SELECTOR);
  let disposed = false;
  button.addEventListener('click', options.onEnter);
  if (options.enabled) {
    options
      .supported()
      .then((supported) => {
        if (supported && !disposed) button.hidden = false;
      })
      .catch(() => {});
  }
  return () => {
    disposed = true;
    button.removeEventListener('click', options.onEnter);
  };
}
