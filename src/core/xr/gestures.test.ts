import { describe, expect, it } from 'vitest';
import { MAX_SCALE, MIN_SCALE, pinchScale, touchAngle, touchDistance, twistYaw } from './gestures';

describe('touchDistance', () => {
  it('measures a 3-4-5 triangle as 5', () => {
    expect(touchDistance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });
});

describe('touchAngle', () => {
  it('gives π/2 for a vertical pair pointing down the screen', () => {
    expect(touchAngle({ x: 0, y: 0 }, { x: 0, y: 10 })).toBeCloseTo(Math.PI / 2);
  });
});

describe('pinchScale', () => {
  it('doubles the scale when the fingers move twice as far apart', () => {
    expect(pinchScale(1, 100, 200)).toBeCloseTo(2);
  });

  it('clamps at the minimum and maximum scale', () => {
    expect(pinchScale(1, 100, 10000)).toBe(MAX_SCALE);
    expect(pinchScale(1, 100, 1)).toBe(MIN_SCALE);
  });

  it('returns the start scale when the start distance is zero', () => {
    expect(pinchScale(1.5, 0, 200)).toBe(1.5);
  });
});

describe('twistYaw', () => {
  it('turns the model the opposite way to a clockwise twist on screen', () => {
    expect(twistYaw(0, 0, Math.PI / 4)).toBeCloseTo(-Math.PI / 4);
  });

  it('takes the short way round when the twist crosses ±π', () => {
    const startAngle = Math.PI - 0.1;
    const angle = -Math.PI + 0.1;
    expect(twistYaw(0, startAngle, angle)).toBeCloseTo(-0.2);
  });

  it('keeps the start yaw when the angle does not change', () => {
    expect(twistYaw(1.2, 0.3, 0.3)).toBeCloseTo(1.2);
  });
});
