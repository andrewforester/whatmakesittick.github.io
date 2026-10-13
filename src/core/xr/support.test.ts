import { describe, expect, it, vi } from 'vitest';
import { isArSupported } from './support';

function systemWith(isSessionSupported: (mode: XRSessionMode) => Promise<boolean>): XRSystem {
  return { isSessionSupported } as unknown as XRSystem;
}

describe('isArSupported', () => {
  it('resolves false when WebXR is missing', async () => {
    await expect(isArSupported(undefined)).resolves.toBe(false);
  });

  it('resolves true when immersive AR is supported', async () => {
    const isSessionSupported = vi.fn(() => Promise.resolve(true));
    await expect(isArSupported(systemWith(isSessionSupported))).resolves.toBe(true);
    expect(isSessionSupported).toHaveBeenCalledWith('immersive-ar');
  });

  it('resolves false when immersive AR is not supported', async () => {
    const system = systemWith(() => Promise.resolve(false));
    await expect(isArSupported(system)).resolves.toBe(false);
  });

  it('resolves false when the check rejects', async () => {
    const system = systemWith(() => Promise.reject(new Error('blocked')));
    await expect(isArSupported(system)).resolves.toBe(false);
  });
});
