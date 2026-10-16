import { Color, Vector3 } from 'three';
import type { MeshStandardMaterial, Object3D } from 'three';
import { clamp, lerp, smoothstep, toRadians } from '@core/math';
import type { AssemblyState } from '../../../ids';
import {
  LIQUID_AREA_CM2,
  MIXING_BEAKER,
  MIXING_FLOOR_Y,
  MIXING_RIM_Y,
  POUR_S,
  mixtureLevelCm,
} from '../../../model';
import { LIQUID_TINTS } from '../../../theme';
import { BEAKER_LOOK, LIQUID_LOOK } from '../../constants';
import { liquidColumn } from '../../geometry/beaker';
import type { BeakerShape } from '../../geometry/beaker';
import { addMesh, label, namedGroup } from '../context';
import type { PartContext, Section } from '../context';
import { OPAQUE_FRAGMENT, WORLD_POSITION_VERTEX, patchMaterial } from '../patches';
import { RENDER_ORDER, addGlassware, addGraduation } from './glassware';
import { pourShareFlow } from './pourMotion';

export const MIXING_SHAPE: BeakerShape = {
  innerRadius: MIXING_BEAKER.innerRadius,
  glass: MIXING_BEAKER.glass,
  height: MIXING_BEAKER.height,
  spoutDeg: BEAKER_LOOK.mixingSpoutDeg,
};

const GRADUATION_STEP_ML = 50;
const GRADUATION_TOP_ML = 600;
const LABEL_STEP_ML = 100;
const HALF = 0.5;
const LABEL_SIDE = 0.72;

const MIXTURE_HEAD = /* glsl */ `
varying vec3 vWorldPos;
uniform float uDepth;
uniform float uBloom;
uniform float uStir;
uniform float uSchlieren;
uniform vec3 uThin;
uniform float uEdgeMix;
uniform float uDeepen;
uniform vec3 uCentre;
`;

const MIXTURE_FRAGMENT = /* glsl */ `
vec3 liquidNormal = normalize(normal);
float liquidFacing = abs(dot(liquidNormal, normalize(vViewPosition)));
float liquidEdge = pow(1.0 - liquidFacing, 2.0);
vec2 fromAxis = vWorldPos.xz - uCentre.xz;
float swirlAngle = atan(fromAxis.y, fromAxis.x);
float swirlRadius = length(fromAxis);
float swirl = sin(swirlAngle * 3.0 + swirlRadius * 1.3 - uStir + vWorldPos.y * 0.9);
float swirlFine = sin(swirlAngle * 7.0 - swirlRadius * 2.1 - uStir * 1.6 + vWorldPos.y * 2.3);
float streak = 0.5 + 0.35 * swirl + 0.15 * swirlFine;
float bloom = uBloom * (streak - 0.5) * 2.0;
gl_FragColor.rgb = mix(gl_FragColor.rgb, gl_FragColor.rgb * 0.35, clamp(bloom, 0.0, 1.0));
gl_FragColor.rgb *= 1.0 - uDeepen * uDepth;
gl_FragColor.rgb = mix(gl_FragColor.rgb, uThin, liquidEdge * uDepth * uEdgeMix);
gl_FragColor.rgb += vec3(0.6, 0.75, 0.85) * uSchlieren * max(0.0, swirlFine) * 0.35;
gl_FragColor.a = clamp(gl_FragColor.a + liquidEdge * mix(0.18, 0.02, uDepth) + uSchlieren * 0.08 * swirl + uBloom * 0.25 * streak, 0.0, 1.0);
`;

interface MixtureUniforms {
  uDepth: { value: number };
  uBloom: { value: number };
  uStir: { value: number };
  uSchlieren: { value: number };
}

function patchMixture(material: MeshStandardMaterial): MixtureUniforms {
  const uniforms: MixtureUniforms = {
    uDepth: { value: 0 },
    uBloom: { value: 0 },
    uStir: { value: 0 },
    uSchlieren: { value: 0 },
  };
  patchMaterial(material, {
    key: 'iodine-mixture',
    uniforms: {
      ...uniforms,
      uThin: { value: new Color(LIQUID_LOOK.thinTint) },
      uEdgeMix: { value: LIQUID_LOOK.edgeMix },
      uDeepen: { value: LIQUID_LOOK.deepen },
      uCentre: { value: new Vector3(...MIXING_BEAKER.base) },
    },
    vertexHead: WORLD_POSITION_VERTEX.head,
    vertex: [WORLD_POSITION_VERTEX.body],
    fragmentHead: MIXTURE_HEAD,
    fragment: [{ after: OPAQUE_FRAGMENT, code: MIXTURE_FRAGMENT }],
  });
  return uniforms;
}

function graduationMarks(): number[] {
  return Array.from(
    { length: GRADUATION_TOP_ML / GRADUATION_STEP_ML },
    (_, step) => (step + 1) * GRADUATION_STEP_ML,
  );
}

export function buildMixingBeaker(context: PartContext, parent: Object3D): Section {
  const root = namedGroup('mixingBeaker', parent);
  root.position.set(...MIXING_BEAKER.base);
  addGlassware(context, root, 'mixingBeaker', MIXING_SHAPE);
  const marks = graduationMarks();
  addGraduation(context, root, 'mixingBeaker', MIXING_SHAPE, {
    millilitres: marks,
    labelled: marks.filter((ml) => ml % LABEL_STEP_ML === 0),
    capacityLabel: `${GRADUATION_TOP_ML} mL`,
    areaCm2: LIQUID_AREA_CM2,
  });
  const outer = MIXING_BEAKER.innerRadius + MIXING_BEAKER.glass;
  const rimAngle = toRadians(-BEAKER_LOOK.printCentreDeg);
  label(context, 'mixingBeaker', root, [
    outer * Math.sin(rimAngle) * LABEL_SIDE - outer * HALF,
    MIXING_BEAKER.height * 0.86,
    outer * Math.cos(rimAngle) * LABEL_SIDE,
  ]);

  const column = liquidColumn(
    MIXING_BEAKER.innerRadius - BEAKER_LOOK.liquidInset,
    BEAKER_LOOK.vortexDip,
    BEAKER_LOOK.vortexRings,
  );
  const mixture = addMesh(context, parent, column, 'mixture', 'mixture');
  mixture.position.y = MIXING_FLOOR_Y;
  mixture.renderOrder = RENDER_ORDER.liquid;
  const liquidMaterial = mixture.material as MeshStandardMaterial;
  const uniforms = patchMixture(liquidMaterial);
  const clear = new Color(LIQUID_TINTS.clear);
  const dark = new Color(LIQUID_TINTS.dark);
  label(context, 'mixture', mixture, [
    -MIXING_BEAKER.innerRadius * 0.35,
    HALF,
    MIXING_BEAKER.innerRadius * 0.6,
  ]);

  return {
    root,
    setState: ({ clock }: AssemblyState) => {
      const level = mixtureLevelCm(pourShareFlow(clock.pour));
      mixture.scale.y = Math.min(level, MIXING_RIM_Y - MIXING_FLOOR_Y);
      const depth = clock.colour;
      liquidMaterial.color.copy(clear).lerp(dark, Math.sqrt(depth));
      liquidMaterial.opacity = lerp(LIQUID_TINTS.clearOpacity, LIQUID_LOOK.darkOpacity, depth);
      uniforms.uDepth.value = depth;
      uniforms.uBloom.value = clamp(4 * depth * (1 - depth), 0, 1) * LIQUID_LOOK.bloomStrength;
      uniforms.uStir.value = toRadians(clock.stirDeg) * 0.08;
      uniforms.uSchlieren.value =
        LIQUID_LOOK.schlierenStrength *
        (1 - smoothstep(clock.seconds, POUR_S, POUR_S + LIQUID_LOOK.schlierenSeconds)) *
        smoothstep(clock.pour, 0.45, 0.6);
    },
  };
}
