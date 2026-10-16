import { describe, expect, it } from 'vitest';
import { Mesh, Vector3 } from 'three';
import { MaterialLibrary } from '@core/scene/materials';
import type { SceneTextures } from '@core/scene/textures';
import { ANCHOR_IDS, PART_IDS, REGION_IDS } from '../ids';
import type { AssemblyState, ScaleId, SpeciesCounts } from '../ids';
import {
  MOLECULE_ORIGIN,
  acidAt,
  bisulfiteAt,
  drawnCounts,
  iodateAt,
  iodideAt,
  iodineAt,
  sulfateAt,
} from '../model';
import { createAssembly } from './assembly';

const SWITCH_S = 10;
const START_IODATE_M = 0.025;

function countsAt(seconds: number): SpeciesCounts {
  return drawnCounts(
    {
      iodateM: iodateAt(seconds, SWITCH_S, START_IODATE_M),
      bisulfiteM: bisulfiteAt(seconds, SWITCH_S),
      sulfateM: sulfateAt(seconds, SWITCH_S),
      iodideM: iodideAt(seconds, SWITCH_S),
      acidM: acidAt(seconds, SWITCH_S),
      iodineM: iodineAt(seconds, SWITCH_S),
    },
    { iodate: 0, bisulfite: 0, sulfate: 0, iodide: 0, hydrogenIon: 0, iodine: 0 },
  );
}

function stateAt(seconds: number, scale: ScaleId = 'beaker'): AssemblyState {
  return {
    scale,
    phase: 0,
    playing: false,
    clock: {
      seconds,
      switchSeconds: SWITCH_S,
      phase: 'induction',
      phaseProgress: 0,
      pour: Math.min(1, seconds),
      stirDeg: seconds * 1440,
      temperatureC: 20,
      iodateM: iodateAt(seconds, SWITCH_S, START_IODATE_M),
      bisulfiteM: bisulfiteAt(seconds, SWITCH_S),
      sulfateM: sulfateAt(seconds, SWITCH_S),
      iodideM: iodideAt(seconds, SWITCH_S),
      acidM: acidAt(seconds, SWITCH_S),
      iodineM: iodineAt(seconds, SWITCH_S),
      lifetimeSeconds: 0,
      colour: 0,
      complex: 0,
      counts: countsAt(seconds),
    },
    landolt: { active: false, cycle: 0, hop: 0 },
    iodineEvent: { active: false, cycle: 0, stage: 'meet', progress: 0 },
    view: { water: true, labels: true },
  };
}

function resources() {
  return { materials: new MaterialLibrary(), textures: {} as unknown as SceneTextures };
}

function shownSpheres(root: { traverse(visit: (object: unknown) => void): void }): number {
  let shown = 0;
  root.traverse((object) => {
    if (object instanceof Mesh && object.geometry.type === 'SphereGeometry' && object.visible) {
      shown += 1;
    }
  });
  return shown;
}

describe('placeholder assembly', () => {
  it('has a label anchor for every part, every anchor and every region', () => {
    const assembly = createAssembly(resources(), stateAt(0));
    expect([...assembly.labelAnchors().keys()].sort()).toEqual([...PART_IDS].sort());
    ANCHOR_IDS.forEach((id) => expect(assembly.anchor(id)).toBeDefined());
    REGION_IDS.forEach((id) => expect(assembly.region(id).isEmpty()).toBe(false));
    assembly.dispose();
  });

  it('shows one world at a time', () => {
    const assembly = createAssembly(resources(), stateAt(5));
    const [beaker, molecules] = assembly.root.children;
    expect([beaker.visible, molecules.visible]).toEqual([true, false]);
    assembly.setState(stateAt(5, 'molecules'));
    expect([beaker.visible, molecules.visible]).toEqual([false, true]);
    expect(assembly.update(0.016, 1)).toBe(false);
    assembly.dispose();
  });

  it('draws one sphere per drawn ion', () => {
    const assembly = createAssembly(resources(), stateAt(2, 'molecules'));
    const expected = (seconds: number) =>
      Object.values(countsAt(seconds)).reduce((sum, count) => sum + count, 0);
    expect(shownSpheres(assembly.root)).toBe(expected(2));
    assembly.setState(stateAt(14, 'molecules'));
    expect(shownSpheres(assembly.root)).toBe(expected(14));
    assembly.dispose();
  });

  it('places the molecule anchors and regions around the molecule origin', () => {
    const assembly = createAssembly(resources(), stateAt(0));
    assembly.root.updateMatrixWorld(true);
    const event = assembly.anchor('eventCentre').getWorldPosition(new Vector3());
    expect(event.y).toBeCloseTo(MOLECULE_ORIGIN[1], 9);
    expect(assembly.region('event').containsPoint(event)).toBe(true);
    const liquid = assembly.anchor('liquidCentre').getWorldPosition(new Vector3());
    expect(assembly.region('beaker').containsPoint(liquid)).toBe(true);
    assembly.dispose();
  });
});
