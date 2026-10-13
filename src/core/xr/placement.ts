import { Matrix4, Mesh, MeshBasicMaterial, RingGeometry } from 'three';
import type { Object3D } from 'three';
import { THEME } from '../theme';

export interface Placement {
  reticle: Object3D;
  update(frame: XRFrame): Matrix4 | undefined;
  placeAt(frame: XRFrame, input: XRInputSource): Matrix4 | undefined;
  dispose(): void;
}

const RETICLE_RADIUS = 0.12;
const RETICLE_WIDTH = 0.02;
const RETICLE_SEGMENTS = 48;
const RETICLE_OPACITY = 0.9;
const TOUCH_PROFILE = 'generic-touchscreen';

function createReticle(): Mesh<RingGeometry, MeshBasicMaterial> {
  const geometry = new RingGeometry(
    RETICLE_RADIUS - RETICLE_WIDTH,
    RETICLE_RADIUS,
    RETICLE_SEGMENTS,
  ).rotateX(-Math.PI / 2);
  const material = new MeshBasicMaterial({
    color: THEME.accent,
    transparent: true,
    opacity: RETICLE_OPACITY,
    depthWrite: false,
  });
  const reticle = new Mesh(geometry, material);
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  return reticle;
}

function poseMatrix(
  result: XRHitTestResult | undefined,
  space: XRReferenceSpace,
): Matrix4 | undefined {
  const pose = result?.getPose(space);
  return pose ? new Matrix4().fromArray(pose.transform.matrix) : undefined;
}

function keep<T extends { cancel(): void }>(
  request: Promise<T> | undefined,
  isDisposed: () => boolean,
  store: (source: T) => void,
): void {
  request
    ?.then((source) => {
      if (isDisposed()) source.cancel();
      else store(source);
    })
    .catch(() => {});
}

export function createPlacement(
  session: XRSession,
  referenceSpace: XRReferenceSpace,
  viewerSpace: XRReferenceSpace,
): Placement {
  const reticle = createReticle();
  let viewerSource: XRHitTestSource | undefined;
  let touchSource: XRTransientInputHitTestSource | undefined;
  let disposed = false;
  const isDisposed = () => disposed;

  keep(session.requestHitTestSource?.({ space: viewerSpace }), isDisposed, (source) => {
    viewerSource = source;
  });
  keep(
    session.requestHitTestSourceForTransientInput?.({ profile: TOUCH_PROFILE }),
    isDisposed,
    (source) => {
      touchSource = source;
    },
  );

  return {
    reticle,
    update: (frame) => {
      const hit = viewerSource
        ? poseMatrix(frame.getHitTestResults(viewerSource)[0], referenceSpace)
        : undefined;
      reticle.visible = hit !== undefined;
      if (hit) reticle.matrix.copy(hit);
      return hit;
    },
    placeAt: (frame, input) => {
      if (!touchSource) return undefined;
      const touch = frame
        .getHitTestResultsForTransientInput(touchSource)
        .find((entry) => entry.inputSource === input);
      return poseMatrix(touch?.results[0], referenceSpace);
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      viewerSource?.cancel();
      touchSource?.cancel();
      viewerSource = undefined;
      touchSource = undefined;
      reticle.removeFromParent();
      reticle.geometry.dispose();
      reticle.material.dispose();
    },
  };
}
