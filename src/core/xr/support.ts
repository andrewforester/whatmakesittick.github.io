const AR_MODE = 'immersive-ar';

function defaultSystem(): XRSystem | undefined {
  return typeof navigator === 'undefined' ? undefined : navigator.xr;
}

export async function isArSupported(xr: XRSystem | undefined = defaultSystem()): Promise<boolean> {
  if (!xr) return false;
  try {
    return await xr.isSessionSupported(AR_MODE);
  } catch {
    return false;
  }
}
