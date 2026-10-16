import { BufferAttribute, BufferGeometry, Color, Mesh, ShaderMaterial } from 'three';
import type { Object3D } from 'three';
import { lerp, smoothstep } from '@core/math';
import { UNDIMMED_GROUP } from '@core/scene/materials';
import type { ScaleId } from '../../ids';
import { CROSSFADE, VEIL } from '../constants';
import { registeredMaterial } from './context';
import type { PartContext } from './context';
import { RENDER_ORDER } from './beaker/glassware';

const VEIL_VERTEX = /* glsl */ `
varying vec2 vScreen;
void main() {
  vScreen = position.xy;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const VEIL_FRAGMENT = /* glsl */ `
uniform float uAmount;
uniform float uProgress;
uniform float uDirection;
uniform vec3 uColour;
uniform vec3 uDeep;
varying vec2 vScreen;
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453);
}
void main() {
  float radius = length(vScreen);
  float angle = atan(vScreen.y, vScreen.x);
  float travel = uDirection > 0.0 ? uProgress : 1.0 - uProgress;
  float streaks = pow(max(0.0, sin(angle * 23.0 + hash(vec2(floor(angle * 23.0 / 6.2832 * 23.0), 1.0)) * 6.0)), 18.0);
  streaks *= smoothstep(0.15, 1.2, radius) * (0.4 + 0.6 * sin(radius * 9.0 - travel * 24.0));
  vec2 cell = floor(vScreen * 7.0 + vec2(0.0, travel * 9.0));
  vec2 local = fract(vScreen * 7.0 + vec2(0.0, travel * 9.0)) - 0.5;
  float seed = hash(cell);
  float bubble = seed > 0.72 ? smoothstep(0.18, 0.12, abs(length(local) - 0.22 * seed)) : 0.0;
  vec3 colour = mix(uDeep, uColour, 0.35 + 0.65 * smoothstep(1.4, 0.0, radius));
  colour += vec3(0.75, 0.9, 1.0) * (streaks * 0.35 + bubble * 0.45);
  gl_FragColor = vec4(colour, uAmount);
  #include <colorspace_fragment>
}
`;

const FULL_SCREEN = new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]);
const XYZ = 3;

export interface DiveLook {
  readonly beakerScale: number;
  readonly moleculeScale: number;
  readonly shown: ScaleId;
  readonly veil: number;
}

export function diveLook(target: ScaleId, share: number): DiveLook {
  const toward = target === 'molecules';
  const outgoing = 1 - smoothstep(share, 0, CROSSFADE.swapAt);
  const incoming = smoothstep(share, CROSSFADE.swapAt, 1);
  const veil = CROSSFADE.veilPeak * Math.sin(Math.PI * Math.min(1, share));
  const zoomed = (amount: number) => lerp(1, CROSSFADE.beakerZoom, amount);
  const shrunk = (amount: number) => lerp(1, CROSSFADE.moleculeStart, amount);
  const swapped = share >= CROSSFADE.swapAt;
  if (toward) {
    return {
      beakerScale: zoomed(1 - outgoing),
      moleculeScale: shrunk(1 - incoming),
      shown: swapped ? 'molecules' : 'beaker',
      veil,
    };
  }
  return {
    beakerScale: zoomed(1 - incoming),
    moleculeScale: shrunk(1 - outgoing),
    shown: swapped ? 'beaker' : 'molecules',
    veil,
  };
}

export class DiveVeil {
  readonly mesh: Mesh;
  private readonly shader: ShaderMaterial;
  private readonly clear = new Color(VEIL.clear);
  private readonly deep = new Color(VEIL.deep);

  constructor(context: PartContext, parent: Object3D) {
    this.shader = registeredMaterial(
      context,
      UNDIMMED_GROUP,
      new ShaderMaterial({
        vertexShader: VEIL_VERTEX,
        fragmentShader: VEIL_FRAGMENT,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        uniforms: {
          uAmount: { value: 0 },
          uProgress: { value: 0 },
          uDirection: { value: 1 },
          uColour: { value: new Color(VEIL.clear) },
          uDeep: { value: new Color(VEIL.navy) },
        },
      }),
    );
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(FULL_SCREEN, XYZ));
    this.mesh = new Mesh(context.tracker.track(geometry), this.shader);
    this.mesh.name = 'diveVeil';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = RENDER_ORDER.veil;
    this.mesh.visible = false;
    parent.add(this.mesh);
  }

  show(target: ScaleId, share: number, depth: number, amount: number): void {
    const uniforms = this.shader.uniforms;
    this.mesh.visible = amount > 0;
    uniforms.uAmount.value = amount;
    uniforms.uProgress.value = share;
    uniforms.uDirection.value = target === 'molecules' ? 1 : -1;
    (uniforms.uColour.value as Color).copy(this.clear).lerp(this.deep, Math.sqrt(depth));
  }
}
