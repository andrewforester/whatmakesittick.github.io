import { clamp, wrapAngle } from '../math';
import type { Point } from '../scene/labelLayout';

export const MIN_SCALE = 0.25;
export const MAX_SCALE = 4;

export function touchDistance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function touchAngle(a: Point, b: Point): number {
  return Math.atan2(b.y - a.y, b.x - a.x);
}

export function pinchScale(startScale: number, startDistance: number, distance: number): number {
  if (startDistance === 0) return startScale;
  return clamp((startScale * distance) / startDistance, MIN_SCALE, MAX_SCALE);
}

export function twistYaw(startYaw: number, startAngle: number, angle: number): number {
  const turn = wrapAngle(angle - startAngle);
  const shortTurn = turn === -Math.PI ? Math.PI : turn;
  return startYaw - shortTurn;
}
