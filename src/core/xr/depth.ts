import type { PerspectiveCamera } from 'three';

const AR_NEAR = 0.01;
const AR_FAR = 20;

export function setArDepth(camera: PerspectiveCamera): () => void {
  const { near, far } = camera;
  camera.near = AR_NEAR;
  camera.far = AR_FAR;
  camera.updateProjectionMatrix();
  return () => {
    camera.near = near;
    camera.far = far;
    camera.updateProjectionMatrix();
  };
}
