// MOVEMENT FEEL — acceleration, not velocity snapping.
//
// THE MODEL. The player is a box (radius 0.34, height 1.72 standing, 1.12
// crouched) moved by acceleration, not by setting velocity directly. On the
// ground the velocity blends toward the wish direction at 42/s; in the air
// at 9/s, so air control exists but is weak. With no input on the ground,
// friction damps the velocity at 9/s. The result is weight: the player
// accelerates into a strafe, stops with a short slide, and cannot turn on
// a dime mid-jump. Walk speed is 5.2 m/s, crouch speed 2.4 m/s.
//
// THE SPEEDS, IN MAP TERMS. At 5.2 m/s the player crosses the 40 m yard in
// ~8 s and reaches a site from spawn in ~10 s — long enough that defenders
// can set up, short enough that a rotate through mid is always an option.
// Jump speed 6.2 m/s against gravity 20 m/s² gives a ~0.96 m hop: enough to
// clear a 1.1 m crate only with a jump onto it (the crate top is the
// landing), never to jump over a 2.4 m wall. Falling speed clamps at −30.
//
// COLLISION, ONE AXIS AT A TIME. Movement is resolved X, then Z, then Y,
// each against the world's colliders as a box test. Moving one axis at a
// time means a wall never swallows the player: sliding along a wall works
// because the blocked axis zeroes its velocity while the free axis still
// moves. The probe box is lifted by a small amount (0.04 m) in the
// horizontal tests so standing on the floor is not read as walking into a
// wall, and the vertical test snaps the player onto the highest collider
// top when falling (position.y = hit.max.y) and pushes the head down when
// jumping into a ceiling (position.y = hit.min.y − height).
//
// CROUCH. Ctrl or C toggles a crouch that halves the height and drops the
// eye from 1.60 m to 1.02 m (lerped at 12/s, so the view dips smoothly
// instead of snapping). Standing up is refused while a 1.72 m box would
// intersect something — the player cannot stand up inside a crate. Crouch
// speed is 2.4 m/s and crouching behind a 1.1 m crate hides the player:
// that is the point of the crates.
// Player movement: acceleration, friction, gravity, crouch and jump, resolved as a box against
// the world's colliders one axis at a time, so a wall never swallows the player.
import * as THREE from 'three';

// THE NUMBERS — the player's feel in one place. RADIUS 0.34 m (the body
// is a capsule 68 cm wide, narrower than the 1 m crates are apart, so the
// player fits through the map's gaps); STAND_HEIGHT 1.72 / CROUCH_HEIGHT
// 1.12 (crouching halves the silhouette, so a crouched player hides
// behind the low cover); WALK_SPEED 5.2 / CROUCH_SPEED 2.4 (crouching is
// slow on purpose — stealth costs speed); GROUND_ACCEL 42 / AIR_ACCEL 9
// (the ground is grippy, the air is not, so a jump keeps its direction
// instead of steering mid-air); FRICTION 9 (stopping is quick, not
// instant — the player decelerates over a step, not a slide); GRAVITY 20
// and JUMP_SPEED 6.2 (a jump clears the 1 m crates and lands in about a
// second). These are the numbers the game feels like; change one and the
// whole movement changes with it.
const RADIUS = 0.34;
const STAND_HEIGHT = 1.72;
const CROUCH_HEIGHT = 1.12;
const STAND_EYE = 1.6;
const CROUCH_EYE = 1.02;
const WALK_SPEED = 5.2;
const CROUCH_SPEED = 2.4;
const GROUND_ACCEL = 42;
const AIR_ACCEL = 9;
const FRICTION = 9;
const GRAVITY = 20;
const JUMP_SPEED = 6.2;

// createPlayer — build the player on a collider list: position, velocity,
// yaw/pitch, eye height, ground state, crouch state, height. The player
// starts at (0, 0, 9.5) facing down mid — a neutral default that
// resetRoundPositions replaces with the attacker spawn before the first
// round, so the initial position is never actually played from. The probe
// box and the wish vector are module-level and reused, like the
// raycaster in main.js: the hot loop never allocates.
export function createPlayer(colliders) {
  const player = {
    position: new THREE.Vector3(0, 0, 9.5),
    velocity: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    eye: STAND_EYE,
    onGround: true,
    crouching: false,
    height: STAND_HEIGHT,
  };
  const probe = new THREE.Box3();
  const wish = new THREE.Vector3();

  // lift keeps the feet and the crown out of the horizontal tests, so standing on the floor
  // is not read as walking into a wall.
  // overlaps — does a box at (x, y, z) with a height, lifted by `lift`,
// intersect any collider? The probe is a Box3, the test is one call per
// collider, and the first hit is returned so the vertical step knows
// which collider top to snap onto. `lift` keeps the feet and the crown
// out of the horizontal tests: standing on the floor must not read as
// walking into a wall, and a low ceiling must not read as a wall either.
// The probe is module-level and reused — the hot loop never allocates.
function overlaps(x, y, z, height, lift) {
    probe.min.set(x - RADIUS, y + lift, z - RADIUS);
    probe.max.set(x + RADIUS, y + height - lift, z + RADIUS);
    for (const collider of colliders) if (probe.intersectsBox(collider)) return collider;
    return null;
  }

  // look — turn the view: yaw from horizontal mouse movement, pitch from
// vertical, clamped to ±1.45 rad (83°) so the player can look almost
// straight up or down but never past it and flip. Sensitivity 0.0022 is
// the feel: one full mouse sweep is roughly a half turn, fast enough to
// check a corner, slow enough to track a head.
function look(dx, dy, sensitivity = 0.0022) {
    player.yaw -= dx * sensitivity;
    player.pitch = Math.max(-1.45, Math.min(1.45, player.pitch - dy * sensitivity));
  }

  // recoil — the camera kick from a shot: pitch up by the kick (clamped so
// sustained fire cannot flip the view over the top) and yaw by a small
// random amount. The weapon's kick value is the base; the jitter is what
// makes each shot feel slightly different. Recoil is applied to the
// player, not the camera, so it survives the next syncCamera.
function recoil(pitchKick, yawKick) {
    player.pitch = Math.min(1.45, player.pitch + pitchKick);
    player.yaw += yawKick;
  }

  // step — one physics slice: crouch state (with the stand-up check),
// eye-height easing, wish direction from the keys and the yaw (forward is
// −z rotated by yaw), acceleration toward the wish speed, friction when
// idle, jump when Space is pressed on the ground, gravity, and the
// axis-separated collision (X, then Z, then Y) that keeps walls solid and
// floors walkable. The ground test runs after the vertical move: falling
// onto a collider top snaps the player onto it and restores onGround, and
// jumping into a ceiling pushes the player back under it.
function step(dt, keys) {
    const crouching = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
    if (crouching && !player.crouching) {
      player.crouching = true;
      player.height = CROUCH_HEIGHT;
    } else if (!crouching && player.crouching && !overlaps(player.position.x, player.position.y, player.position.z, STAND_HEIGHT, 0.02)) {
      player.crouching = false;
      player.height = STAND_HEIGHT;
    }
    const eyeTarget = player.crouching ? CROUCH_EYE : STAND_EYE;
    player.eye += (eyeTarget - player.eye) * Math.min(1, dt * 12);

    const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    wish.set(0, 0, 0);
    if (forward || strafe) {
      const sin = Math.sin(player.yaw);
      const cos = Math.cos(player.yaw);
      wish.set(-sin * forward + cos * strafe, 0, -cos * forward - sin * strafe).normalize();
    }

    const speed = player.crouching ? CROUCH_SPEED : WALK_SPEED;
    const blend = Math.min(1, (player.onGround ? GROUND_ACCEL : AIR_ACCEL) * dt / speed);
    player.velocity.x += (wish.x * speed - player.velocity.x) * blend;
    player.velocity.z += (wish.z * speed - player.velocity.z) * blend;
    if (player.onGround && !wish.lengthSq()) {
      const damp = Math.max(0, 1 - FRICTION * dt);
      player.velocity.x *= damp;
      player.velocity.z *= damp;
    }

    if (keys.has('Space') && player.onGround) {
      player.velocity.y = JUMP_SPEED;
      player.onGround = false;
    }
    player.velocity.y -= GRAVITY * dt;

    const nextX = player.position.x + player.velocity.x * dt;
    if (!overlaps(nextX, player.position.y, player.position.z, player.height, 0.04)) player.position.x = nextX;
    else player.velocity.x = 0;
    const nextZ = player.position.z + player.velocity.z * dt;
    if (!overlaps(player.position.x, player.position.y, nextZ, player.height, 0.04)) player.position.z = nextZ;
    else player.velocity.z = 0;

    player.position.y += player.velocity.y * dt;
    player.onGround = false;
    const hit = overlaps(player.position.x, player.position.y, player.position.z, player.height, 0);
    if (hit && player.velocity.y <= 0) {
      player.position.y = hit.max.y;
      player.velocity.y = 0;
      player.onGround = true;
    } else if (hit) {
      player.position.y = hit.min.y - player.height;
      player.velocity.y = 0;
    }
    if (player.position.y < 0) {
      player.position.y = 0;
      player.velocity.y = 0;
      player.onGround = true;
    }
    player.velocity.y = Math.max(-30, player.velocity.y);
  }

  return {
    state: player,
    step,
    look,
    recoil,
    // groundSpeed — the horizontal speed, for spread and footsteps. The
// weapon's spread scales with this (full spread at 5.2 m/s) and the
// footstep timer only runs above 1 m/s, so standing still is silent and
// walking is audible — the player hears their own speed.
groundSpeed() {
      return Math.hypot(player.velocity.x, player.velocity.z);
    },
  };
}
