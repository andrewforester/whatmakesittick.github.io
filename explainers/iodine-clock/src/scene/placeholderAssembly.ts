import { Group, Mesh, SphereGeometry } from 'three';
import type { Box3, BufferGeometry, Object3D } from 'three';
import { clamp, lerp, toRadians } from '@core/math';
import { box } from '@core/scene/geometry/box';
import { anchorAt } from '@core/scene/parts';
import { regionFromSpec } from '@core/scene/regions';
import type { RegionSpec } from '@core/scene/regions';
import { ANCHOR_IDS, ANCHOR_SCALE, MOLECULE_PART_IDS, SCALE_IDS, SPECIES_IDS } from '../ids';
import type {
  AnchorId,
  AssemblyState,
  ElementId,
  PartId,
  Point,
  RegionId,
  ScaleId,
  SpeciesId,
} from '../ids';
import {
  ANCHOR_POINTS,
  DRAW_RADIUS_A,
  EVENT_CENTRE,
  HELIX_AXIS,
  HELIX_GEOMETRY,
  MAX_DRAWN_COUNTS,
  MIXING_BEAKER,
  MIXING_FLOOR_Y,
  MIXING_RIM_Y,
  POUR_BEAKER,
  SCALE_ORIGIN,
  SOLUTION_BOX,
  STIR_BAR,
  STIR_BAR_Y,
  STIRRER,
  STOPWATCH,
  THERMOMETER,
  mixtureLevelCm,
  pourBeakerLevelCm,
  worldRegionSpec,
} from '../model';
import { ATOM_COLOURS, THEME } from '../theme';
import type { Assembly, AssemblyResources } from './assembly';

type BeakerPartId = Exclude<PartId, (typeof MOLECULE_PART_IDS)[number]>;

const SPHERE_SEGMENTS = 12;
const ROD_HALF_WIDTH = 0.2;
const STREAM_HALF_WIDTH = 0.3;
const MARKER_HALF_A = 1;
const POUR_TILT_DEG = 100;
const HALF = 0.5;

const SPECIES_ELEMENT: Readonly<Record<SpeciesId, ElementId>> = {
  iodate: 'I',
  bisulfite: 'S',
  sulfate: 'S',
  iodide: 'I',
  hydrogenIon: 'H',
  iodine: 'I',
};

const SCATTER_STEP: Point = [0.8191725, 0.6710436, 0.5497005];
const SCATTER_START = 0.5;

const MOLECULE_SPOTS: Readonly<Record<(typeof MOLECULE_PART_IDS)[number], Point>> = {
  iodate: [EVENT_CENTRE[0] - 3, EVENT_CENTRE[1], EVENT_CENTRE[2]],
  bisulfite: [EVENT_CENTRE[0] + 3, EVENT_CENTRE[1], EVENT_CENTRE[2]],
  sulfate: [EVENT_CENTRE[0] + 6, EVENT_CENTRE[1] + 3, EVENT_CENTRE[2]],
  iodide: [EVENT_CENTRE[0], EVENT_CENTRE[1] - 3, EVENT_CENTRE[2]],
  hydrogenIon: [EVENT_CENTRE[0] + 6, EVENT_CENTRE[1] - 3, EVENT_CENTRE[2]],
  iodine: [EVENT_CENTRE[0], EVENT_CENTRE[1] + 3, EVENT_CENTRE[2]],
  triiodide: [HELIX_AXIS.x, HELIX_AXIS.y[1] - HELIX_GEOMETRY.pitchA, HELIX_AXIS.z],
  polyiodide: [HELIX_AXIS.x, 0, HELIX_AXIS.z],
  amylose: [HELIX_AXIS.x + HELIX_GEOMETRY.outerRadiusA, 0, HELIX_AXIS.z],
  glucose: [HELIX_AXIS.x - HELIX_GEOMETRY.outerRadiusA, HELIX_GEOMETRY.pitchA, HELIX_AXIS.z],
  water: [SOLUTION_BOX.x[1] - 4, SOLUTION_BOX.y[1] - 4, 0],
};

function fraction(value: number): number {
  return value - Math.floor(value);
}

function scatterPoint(index: number): Point {
  const along = (axis: 0 | 1 | 2, [min, max]: readonly [number, number]) =>
    lerp(min, max, fraction(SCATTER_START + SCATTER_STEP[axis] * (index + 1)));
  return [along(0, SOLUTION_BOX.x), along(1, SOLUTION_BOX.y), along(2, SOLUTION_BOX.z)];
}

function specBox({ x, y, z }: RegionSpec): BufferGeometry {
  return box({ minX: x[0], maxX: x[1], minY: y[0], maxY: y[1], minZ: z[0], maxZ: z[1] });
}

function cylinderBox(radius: number, bottom: number, top: number): BufferGeometry {
  return specBox({ x: [-radius, radius], y: [bottom, top], z: [-radius, radius] });
}

function centredBox([x, y, z]: Point, [width, height, depth]: Point): BufferGeometry {
  return specBox({
    x: [x - width * HALF, x + width * HALF],
    y: [y - height * HALF, y + height * HALF],
    z: [z - depth * HALF, z + depth * HALF],
  });
}

function midpoint(from: Point, to: Point): Point {
  return [lerp(from[0], to[0], HALF), lerp(from[1], to[1], HALF), lerp(from[2], to[2], HALF)];
}

class PlaceholderAssembly implements Assembly {
  readonly root = new Group();
  private readonly roots: Record<ScaleId, Group> = { beaker: new Group(), molecules: new Group() };
  private readonly pourGroup = new Group();
  private readonly labels = new Map<PartId, Object3D>();
  private readonly anchors = new Map<AnchorId, Object3D>();
  private readonly geometries: BufferGeometry[] = [];
  private readonly spheres = new Map<SpeciesId, Mesh[]>();
  private readonly beakerMeshes = new Map<BeakerPartId, Mesh>();

  private readonly resources: AssemblyResources;

  constructor(resources: AssemblyResources, state: AssemblyState) {
    this.resources = resources;
    SCALE_IDS.forEach((scale) => {
      this.roots[scale].position.set(...SCALE_ORIGIN[scale]);
      this.root.add(this.roots[scale]);
    });
    this.buildBeakerWorld();
    this.buildMoleculeWorld();
    ANCHOR_IDS.forEach((id) =>
      this.anchors.set(id, anchorAt(this.roots[ANCHOR_SCALE[id]], ...ANCHOR_POINTS[id])),
    );
    this.setState(state);
  }

  private track(geometry: BufferGeometry): BufferGeometry {
    this.geometries.push(geometry);
    return geometry;
  }

  private addBeakerPart(
    id: BeakerPartId,
    geometry: BufferGeometry,
    color: string,
    parent: Object3D = this.roots.beaker,
  ): Mesh {
    const finish = { color, roughness: 0.6, metalness: 0.1 };
    const mesh = new Mesh(this.track(geometry), this.resources.materials.get(id, finish));
    parent.add(mesh);
    this.beakerMeshes.set(id, mesh);
    this.labels.set(id, mesh);
    return mesh;
  }

  private buildBeakerWorld(): void {
    const outer = MIXING_BEAKER.innerRadius + MIXING_BEAKER.glass;
    this.addBeakerPart('stirrer', specBox(STIRRER), THEME.metalDark);
    this.addBeakerPart(
      'mixingBeaker',
      cylinderBox(outer, MIXING_BEAKER.base[1], MIXING_RIM_Y),
      THEME.metalLight,
    );
    this.addBeakerPart(
      'mixture',
      cylinderBox(MIXING_BEAKER.innerRadius, 0, 1),
      THEME.clearLiquid,
    ).position.y = MIXING_FLOOR_Y;
    const bar = this.addBeakerPart(
      'stirBar',
      centredBox([0, 0, 0], [STIR_BAR.length, STIR_BAR.height, STIR_BAR.width]),
      THEME.text,
    );
    bar.position.y = STIR_BAR_Y;
    this.addBeakerPart(
      'thermometer',
      centredBox(midpoint(THERMOMETER.bulb, THERMOMETER.top), [
        ROD_HALF_WIDTH,
        THERMOMETER.top[1] - THERMOMETER.bulb[1],
        ROD_HALF_WIDTH,
      ]),
      THEME.metalLight,
    );
    this.addBeakerPart('stopwatch', centredBox(STOPWATCH.centre, STOPWATCH.size), THEME.metal);
    this.buildPourBeaker();
  }

  private buildPourBeaker(): void {
    const outer = POUR_BEAKER.innerRadius + POUR_BEAKER.glass;
    this.roots.beaker.add(this.pourGroup);
    this.addBeakerPart(
      'pourBeaker',
      cylinderBox(outer, 0, POUR_BEAKER.height),
      THEME.metalLight,
      this.pourGroup,
    );
    this.addBeakerPart(
      'bisulfiteSolution',
      cylinderBox(POUR_BEAKER.innerRadius, 0, 1),
      THEME.clearLiquid,
      this.pourGroup,
    ).position.y = POUR_BEAKER.glass;
    this.addBeakerPart(
      'pourStream',
      specBox({
        x: [-STREAM_HALF_WIDTH, STREAM_HALF_WIDTH],
        y: [0, 1],
        z: [-STREAM_HALF_WIDTH, STREAM_HALF_WIDTH],
      }),
      THEME.clearLiquid,
    );
  }

  private buildMoleculeWorld(): void {
    const geometry = this.track(new SphereGeometry(1, SPHERE_SEGMENTS, SPHERE_SEGMENTS));
    let index = 0;
    SPECIES_IDS.forEach((species) => {
      const element = SPECIES_ELEMENT[species];
      const material = this.resources.materials.get(species, {
        color: ATOM_COLOURS[element],
        roughness: 0.5,
      });
      const pool = Array.from({ length: MAX_DRAWN_COUNTS[species] }, () => {
        const sphere = new Mesh(geometry, material);
        sphere.scale.setScalar(DRAW_RADIUS_A[element]);
        sphere.position.set(...scatterPoint(index));
        index += 1;
        this.roots.molecules.add(sphere);
        return sphere;
      });
      this.spheres.set(species, pool);
    });
    this.buildMoleculeMarkers();
  }

  private buildMoleculeMarkers(): void {
    const marker = this.track(
      centredBox([0, 0, 0], [MARKER_HALF_A * 2, MARKER_HALF_A * 2, MARKER_HALF_A * 2]),
    );
    MOLECULE_PART_IDS.forEach((id) => {
      const mesh = new Mesh(
        marker,
        this.resources.materials.get(id, { color: THEME.amylose, roughness: 0.7 }),
      );
      mesh.position.set(...MOLECULE_SPOTS[id]);
      this.roots.molecules.add(mesh);
      this.labels.set(id, mesh);
    });
  }

  private placePour(pour: number): void {
    const reach = clamp(pour / POUR_BEAKER.lipReachedAt, 0, 1);
    const [restX, restY, restZ] = POUR_BEAKER.rest;
    const [lipX, lipY, lipZ] = POUR_BEAKER.lip;
    this.pourGroup.position.set(
      lerp(restX, lipX, reach),
      lerp(restY, lipY, reach),
      lerp(restZ, lipZ, reach),
    );
    this.pourGroup.rotation.z = toRadians(POUR_TILT_DEG * reach);
    this.setHeight('bisulfiteSolution', pourBeakerLevelCm(pour));
    const stream = this.beakerMeshes.get('pourStream');
    if (!stream) return;
    const surface = MIXING_FLOOR_Y + mixtureLevelCm(pour);
    stream.visible = pour > 0 && pour < 1;
    stream.position.set(lipX, surface, lipZ);
    stream.scale.y = lipY - surface;
  }

  private setHeight(id: BeakerPartId, height: number): void {
    const mesh = this.beakerMeshes.get(id);
    if (!mesh) return;
    mesh.visible = height > 0;
    if (height > 0) mesh.scale.y = height;
  }

  setState(state: AssemblyState): void {
    SCALE_IDS.forEach((scale) => (this.roots[scale].visible = state.scale === scale));
    const { clock, view } = state;
    this.setHeight('mixture', mixtureLevelCm(clock.pour));
    this.placePour(clock.pour);
    const bar = this.beakerMeshes.get('stirBar');
    if (bar) bar.rotation.y = toRadians(clock.stirDeg);
    SPECIES_IDS.forEach((species) =>
      this.spheres.get(species)?.forEach((sphere, index) => {
        sphere.visible = index < clock.counts[species];
      }),
    );
    const water = this.labels.get('water');
    if (water) water.visible = view.water;
  }

  update(): boolean {
    return false;
  }

  labelAnchors(): ReadonlyMap<PartId, Object3D> {
    return this.labels;
  }

  anchor(id: AnchorId): Object3D {
    const found = this.anchors.get(id);
    if (!found) throw new Error(`Missing anchor ${id}`);
    return found;
  }

  region(id: RegionId): Box3 {
    return regionFromSpec(worldRegionSpec(id));
  }

  dispose(): void {
    this.geometries.forEach((geometry) => geometry.dispose());
    this.root.removeFromParent();
  }
}

export function createPlaceholderAssembly(
  resources: AssemblyResources,
  state: AssemblyState,
): Assembly {
  return new PlaceholderAssembly(resources, state);
}
