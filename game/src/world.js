// MAP DESIGN — why the yard is shaped this way.
//
// THE IDEA. Three lanes, two sites, one mid. The lanes are separated by
// container stacks and walls so each lane is its own fight, but the mid yard
// connects them all: a player can rotate from A to B through mid without
// going back to spawn. That is the whole tactical shape — commit to a lane,
// or pay time to rotate.
//
// SIGHTLINES. Long down the lanes (good for rifles: A-long and B-long run
// the full 40 m depth) and short inside the sites (good for SMGs and the
// bomb plant: the site pockets are ~9 m across). The central double-stacked
// container (2.6 m tall) blocks sight across mid, so mid is a crossroads
// with cover, not a firing line. The lane dividers leave a gap at z 2..6 so
// players can cross between lanes without retreating to spawn.
//
// COVER HEIGHTS. Two heights only: crates at 1.1 m (crouch cover — a
// crouching player is hidden behind a crate and a standing player is not)
// and walls/containers at 2.4–2.6 m (full cover that blocks sight and shots).
// Every box is both a collider (player and bots) and a shootable (bullets
// stop on it), so cover is honest: if you cannot see over it, you cannot
// shoot over it, and neither can the bots.
//
// THE SITES. Each site is a walled pocket with two entrances, so a plant
// can be covered from two angles and a retake has two ways in. The plant
// zone is a marked pad (a flat amber plane with a painted border), not
// geometry: the plant spot is readable at a glance, and the 4.5 m radius is
// generous enough that the plant channel rarely fails on positioning. Crates
// inside each site give the planter crouch cover around the pad.
//
// SPAWNS. Attackers start south (z +16..18), defenders north (z −16..−17),
// each as a list of positions so teammates do not stack on one point.
// Attacker spawn has two low walls so the spawn itself is not a firing
// line down mid. Defender spawns sit just behind their sites, so defenders
// reach a hold position in a few seconds while attackers need ~10 s to
// arrive — the defenders' head start is what makes holding possible.
//
// LIGHT. A warm late-afternoon key (2.6, from the south-east), a cool fill
// (0.5, from the north-west) and a sky/ground hemisphere gradient (1.5).
// Shadows are 2048 px over a 60 m ortho box — big enough for the whole yard,
// small enough to stay sharp. Fog (35–85 m) warms the distance without
// hiding the far wall: the yard is 48 m wide, so the far side is always
// visible, just hazed.
// Emberline Yard: an original industrial yard map for a round-based tactical FPS.
//
// LAYOUT (x east-west, z north-south; north is -z, so defenders spawn at -z and
// attackers at +z). The yard is 48 m wide (x -24..24) and 40 m deep (z -20..20).
//
//   Site A (warehouse, west)          Site B (depot, east)
//     x -18, z -12                      x 18, z -12
//        |                                |
//   A-long (west lane)   Mid (open yard)   B-long (east lane)
//        |                  |                  |
//        +-------- Attacker spawn (z +16) ------+
//
// Three lanes, two sites, one mid. The lanes are separated by container stacks
// and walls so each lane is its own fight, but the mid yard connects them all:
// a player can rotate from A to B through mid without going back to spawn.
// Sightlines are long down the lanes (good for rifles) and short inside the
// sites (good for SMGs and the bomb plant). Cover is crates and containers at
// crouch height (1.1 m) and wall height (2.4 m), so a crouching player is hidden
// behind a crate and a standing player is not.
//
// Every box is a collider (player and bots) and a shootable (bullets stop on
// it). The bomb sites are marked zones, not geometry: a flat pad on the ground
// with a painted border, so the plant spot is readable at a glance. Waypoints
// for the bots are defined here too, because the routes belong to the map.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

// The two bomb sites, as ground pads. A plant only counts inside one of these.
export const SITES = {
  A: { name: 'A', center: new THREE.Vector3(-18, 0, -12), radius: 4.5 },
  B: { name: 'B', center: new THREE.Vector3(18, 0, -12), radius: 4.5 },
};

// Spawns. Attackers start south, defenders north. Each spawn is a list of
// positions so teammates do not stack on one point.
export const SPAWNS = {
  attackers: [
    new THREE.Vector3(-3, 0, 16),
    new THREE.Vector3(0, 0, 17),
    new THREE.Vector3(3, 0, 16),
    new THREE.Vector3(-1.5, 0, 18),
  ],
  defenders: [
    new THREE.Vector3(-16, 0, -16),
    new THREE.Vector3(-10, 0, -17),
    new THREE.Vector3(10, 0, -17),
    new THREE.Vector3(16, 0, -16),
  ],
};

// Bot routes: waypoint lists from a spawn to a site. A bot walks its route,
// pauses at the end, and holds. The routes use the lanes, so bots actually
// play the map instead of cutting across the mid yard in a straight line.
export const ROUTES = {
  // Attackers push from south spawn to a site.
  toA: [
    new THREE.Vector3(-3, 0, 16),
    new THREE.Vector3(-8, 0, 10),
    new THREE.Vector3(-16, 0, 6),
    new THREE.Vector3(-20, 0, -2),
    new THREE.Vector3(-18, 0, -10),
  ],
  toB: [
    new THREE.Vector3(3, 0, 16),
    new THREE.Vector3(8, 0, 10),
    new THREE.Vector3(16, 0, 6),
    new THREE.Vector3(20, 0, -2),
    new THREE.Vector3(18, 0, -10),
  ],
  toMid: [
    new THREE.Vector3(0, 0, 17),
    new THREE.Vector3(0, 0, 8),
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, -6),
  ],
  // Defenders rotate from north spawn to a site to hold it.
  defA: [
    new THREE.Vector3(-13, 0, -16),
    new THREE.Vector3(-16, 0, -14),
    new THREE.Vector3(-18, 0, -12),
  ],
  defB: [
    new THREE.Vector3(13, 0, -16),
    new THREE.Vector3(16, 0, -14),
    new THREE.Vector3(18, 0, -12),
  ],
  // A defender rotating from A to B through mid (used when the bomb is spotted at B).
  rotateAB: [
    new THREE.Vector3(-18, 0, -12),
    new THREE.Vector3(-10, 0, -8),
    new THREE.Vector3(0, 0, -6),
    new THREE.Vector3(10, 0, -8),
    new THREE.Vector3(18, 0, -12),
  ],
  rotateBA: [
    new THREE.Vector3(18, 0, -12),
    new THREE.Vector3(10, 0, -8),
    new THREE.Vector3(0, 0, -6),
    new THREE.Vector3(-10, 0, -8),
    new THREE.Vector3(-18, 0, -12),
  ],
};

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' || name === 'ink' ? 0.55 : 0.92,
      metalness: 0.03,
    });
  }
  // A warm sand floor material for the yard, distinct from the grey walls.
  const sand = new THREE.MeshStandardMaterial({ color: new THREE.Color('#b59a6a'), roughness: 0.95, metalness: 0 });
  const rust = new THREE.MeshStandardMaterial({ color: new THREE.Color('#8a4a2a'), roughness: 0.8, metalness: 0.15 });

  const colliders = [];
  const shootables = [];

  function box(width, height, depth, x, y, z, material) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
    return mesh;
  }

  // Floor (sand) and the outer walls (dark steel).
  const floor = new THREE.Mesh(new THREE.BoxGeometry(48.4, 0.4, 40.4), sand);
  floor.position.set(0, -0.2, 0);
  floor.receiveShadow = true;
  group.add(floor);
  colliders.push(new THREE.Box3().setFromObject(floor));
  shootables.push(floor);

  box(0.4, 5, 40.4, -24.2, 2.5, 0, materials.surface); // west wall
  box(0.4, 5, 40.4, 24.2, 2.5, 0, materials.surface); // east wall
  box(48.4, 5, 0.4, 0, 2.5, -20.2, materials.surface); // north wall
  box(48.4, 5, 0.4, 0, 2.5, 20.2, materials.surface); // south wall

  // --- Lane dividers: container stacks that split the yard into A-long, Mid, B-long.
  // West divider (between A-long and Mid), with a gap at z 2..6 so players can cross.
  box(0.8, 2.6, 8, -12, 1.3, -8, rust);
  box(0.8, 2.6, 6, -12, 1.3, 6, rust);
  // East divider (between Mid and B-long), gap at z 2..6.
  box(0.8, 2.6, 8, 12, 1.3, -8, rust);
  box(0.8, 2.6, 6, 12, 1.3, 6, rust);

  // --- Site A (warehouse, west): a walled pocket with two entrances.
  // South wall of the pocket, with a wide entrance gap at x -20..-16.
  box(6, 2.6, 0.6, -21, 1.3, -7.5, materials.surface);
  // East wall of the pocket, entrance gap at z -10..-6.
  box(0.6, 2.6, 5, -13.5, 1.3, -15, materials.surface);
  // Crates inside site A: crouch cover around the plant pad.
  box(1.6, 1.1, 1.6, -20.5, 0.55, -10, materials.hairline);
  box(1.6, 1.1, 1.6, -15.5, 0.55, -14, materials.hairline);
  box(2.4, 1.1, 1.2, -18, 0.55, -15.5, materials.hairline);

  // --- Site B (depot, east): a walled pocket, mirrored.
  box(6, 2.6, 0.6, 21, 1.3, -7.5, materials.surface);
  box(0.6, 2.6, 5, 13.5, 1.3, -15, materials.surface);
  box(1.6, 1.1, 1.6, 20.5, 0.55, -10, materials.hairline);
  box(1.6, 1.1, 1.6, 15.5, 0.55, -14, materials.hairline);
  box(2.4, 1.1, 1.2, 18, 0.55, -15.5, materials.hairline);

  // --- Mid yard: crates and a central container stack, the crossroads.
  box(2.4, 1.1, 1.2, -4, 0.55, 2, materials.hairline);
  box(2.4, 1.1, 1.2, 4, 0.55, 2, materials.hairline);
  box(1.6, 1.1, 1.6, -6, 0.55, -4, materials.hairline);
  box(1.6, 1.1, 1.6, 6, 0.55, -4, materials.hairline);
  // Central double-stacked container: the mid landmark, 2.6 m tall so it blocks sight.
  box(3.2, 2.6, 2.4, 0, 1.3, -2, rust);
  box(2.4, 1.1, 1.2, 0, 0.55, 6, materials.hairline);

  // --- A-long cover: crates along the west lane.
  box(1.6, 1.1, 1.6, -20, 0.55, 2, materials.hairline);
  box(1.6, 1.1, 1.6, -20, 0.55, 10, materials.hairline);
  box(2.4, 1.1, 1.2, -18, 0.55, 6, materials.hairline);

  // --- B-long cover: crates along the east lane.
  box(1.6, 1.1, 1.6, 20, 0.55, 2, materials.hairline);
  box(1.6, 1.1, 1.6, 20, 0.55, 10, materials.hairline);
  box(2.4, 1.1, 1.2, 18, 0.55, 6, materials.hairline);

  // --- Attacker spawn cover: two low walls so the spawn is not a firing line.
  box(3.2, 1.1, 0.8, -6, 0.55, 14, materials.hairline);
  box(3.2, 1.1, 0.8, 6, 0.55, 14, materials.hairline);

  // --- Bomb site pads: flat painted borders on the ground, readable at a glance.
  function sitePad(site) {
    const pad = new THREE.Mesh(
      new THREE.PlaneGeometry(site.radius * 2, site.radius * 2),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.14, side: THREE.DoubleSide }),
    );
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(site.center.x, 0.02, site.center.z);
    pad.receiveShadow = true;
    group.add(pad);
    const border = new THREE.Mesh(
      new THREE.BoxGeometry(site.radius * 2, 0.06, 0.3),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent) }),
    );
    border.position.set(site.center.x, 0.03, site.center.z - site.radius);
    group.add(border);
    const border2 = border.clone();
    border2.position.set(site.center.x, 0.03, site.center.z + site.radius);
    group.add(border2);
    return pad;
  }
  sitePad(SITES.A);
  sitePad(SITES.B);

  // Light: a warm late-afternoon key, a cool fill, and a sky/ground gradient.
  const sky = new THREE.HemisphereLight(new THREE.Color('#ffe0b0'), new THREE.Color('#6b5238'), 1.5);
  scene.add(sky);

  const key = new THREE.DirectionalLight(new THREE.Color('#ffd9a0'), 2.6);
  key.position.set(14, 18, 10);
  key.target.position.set(0, 0, -4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -30;
  key.shadow.camera.right = 30;
  key.shadow.camera.top = 30;
  key.shadow.camera.bottom = -30;
  key.shadow.camera.far = 70;
  key.shadow.bias = -0.0006;
  scene.add(key, key.target);

  const fill = new THREE.DirectionalLight(new THREE.Color(PALETTE.muted), 0.5);
  fill.position.set(-12, 10, 14);
  scene.add(fill);

  return { colliders, shootables, group, sites: SITES, spawns: SPAWNS, routes: ROUTES };
}
