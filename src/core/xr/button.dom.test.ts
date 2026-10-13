import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mountArButton } from './button';

const PAGE = `
  <section class="stage" data-stage>
    <button type="button" class="stage-ar" data-control="ar" hidden></button>
  </section>
`;

function button(): HTMLButtonElement {
  const element = document.querySelector<HTMLButtonElement>('[data-control="ar"]');
  if (!element) throw new Error('No AR button');
  return element;
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('AR button', () => {
  beforeEach(() => {
    document.body.innerHTML = PAGE;
  });

  it('stays hidden and skips the check when disabled', async () => {
    const supported = vi.fn(() => Promise.resolve(true));
    mountArButton(document, { enabled: false, supported, onEnter: vi.fn() });
    await settle();
    expect(supported).not.toHaveBeenCalled();
    expect(button().hidden).toBe(true);
  });

  it('stays hidden when AR is not supported', async () => {
    mountArButton(document, {
      enabled: true,
      supported: () => Promise.resolve(false),
      onEnter: vi.fn(),
    });
    await settle();
    expect(button().hidden).toBe(true);
  });

  it('shows the button when AR is supported', async () => {
    mountArButton(document, {
      enabled: true,
      supported: () => Promise.resolve(true),
      onEnter: vi.fn(),
    });
    await settle();
    expect(button().hidden).toBe(false);
  });

  it('calls onEnter once per click', async () => {
    const onEnter = vi.fn();
    mountArButton(document, { enabled: true, supported: () => Promise.resolve(true), onEnter });
    await settle();
    button().click();
    expect(onEnter).toHaveBeenCalledTimes(1);
  });

  it('removes the click listener on dispose', async () => {
    const onEnter = vi.fn();
    const dispose = mountArButton(document, {
      enabled: true,
      supported: () => Promise.resolve(true),
      onEnter,
    });
    await settle();
    dispose();
    button().click();
    expect(onEnter).not.toHaveBeenCalled();
  });

  it('does not show the button after dispose', async () => {
    const dispose = mountArButton(document, {
      enabled: true,
      supported: () => Promise.resolve(true),
      onEnter: vi.fn(),
    });
    dispose();
    await settle();
    expect(button().hidden).toBe(true);
  });
});
