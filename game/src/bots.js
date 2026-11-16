// BOT AI — design notes.
//
// THE MIND, IN PRIORITY ORDER. Every bot runs the same step, once per fixed
// step, and the first matching state wins:
//   dead    — down, out of the round; the body falls over (0.4 s) and stays.
//   combat  — an enemy is visible. Stop, face it, fire in bursts. The burst
//             is inaccurate on purpose: a bot that never missed would be
//             unbeatable, and a bot that never hit would be a target dummy.
//   rotate  — the bomb is planted at the other site (defenders only). Walk
//             the rotate route to the planted site instead of holding.
//   move    — walk the route's waypoints. At the last waypoint, hold.
//   hold    — at the end of the route, stand and scan slowly (±0.7 rad at
//             0.5 rad/s), waiting for an enemy to walk into view.
//
// VISION. A bot sees an enemy when all three hold: within 45 m, inside a
// 100-degree cone in front of it (half-angle 0.87 rad), and a ray from its
// eyes to the enemy's chest hits nothing but the enemy. The ray is the
// expensive part, so it is checked at most every 0.15 s per bot, staggered by
// a random offset, never every frame for every bot. Only the world's
// shootables block the ray — other bots do not, so a bot can see past a
// teammate. A bot that is shot turns toward the shooter: playerShoot sets
// its target to the player directly, because a bot that ignores being shot
// at reads as a target dummy.
//
// SHOOTING. A bot fires hitscan with a spread cone (0.035 rad, +0.02 while
// moving) and damage falloff: 30 body / 85 head at close range, halved past
// 25 m and out to 45 m. It fires in bursts of 3–5 shots (0.13 s apart) with
// a 0.55 s pause between bursts, and it waits out a 0.45 s reaction delay
// after first sighting a target — the player gets a beat to react before the
// first burst lands. Accuracy is worse while the bot is moving, so a bot
// that is pushing a lane is less dangerous than one holding an angle.
//
// MOVEMENT. Bots walk at 3.4 m/s along straight segments between waypoints
// and count a waypoint reached within 0.6 m. They do not collide with the
// world (their routes stay in open lanes) and they do not collide with each
// other; the routes are designed so teammates rarely stack. Legs swing with
// a walk phase while moving and snap back to zero while holding or fighting.
//
// TUNING RATIONALE. The numbers above are the difficulty: reaction 0.45 s
// plus burst spread means a single bot rarely kills a healthy player before
// the player can answer, but two bots focusing fire will. Defenders hold
// sites and rotate on plant; attackers push lanes. The asymmetry is the game:
// attackers have the initiative and the bomb, defenders have the angles.
// Bots: the other nine players. Three attacker teammates and four defenders
// (the player is the fourth attacker). A bot is a body with a route, a gun and
// a simple mind: walk the route, look for enemies, shoot what it sees.
//
// MIND — one state per bot, in priority order:
//   dead: down, out of the round.
//   combat: an enemy is visible. Stop, face it, and fire in bursts with a
//     reaction delay after first sighting. The burst is inaccurate on purpose:
//     a bot that never missed would be unbeatable, and a bot that never hit
//     would be a target dummy.
//   rotate: the bomb is planted at the other site (defenders only). Walk the
//     rotate route to the planted site.
//   move: walk the route's waypoints. At the last waypoint, hold: stand, scan
//     slowly, and wait for an enemy to walk into view.
//   hold: at the end of the route, standing and scanning.
//
// VISION — a bot sees an enemy when all three hold: within 45 m, inside a
// 100-degree cone in front of it, and a ray from its eyes to the enemy's chest
// hits nothing but the enemy. The ray is the expensive part, so it is checked
// at most every 0.15 s per bot, staggered, never every frame for every bot.
// A bot that is shot (hears the shot) turns toward the shooter, because a bot
// that ignores being shot at is a target dummy.
//
// SHOOTING — a bot fires hitscan with a spread cone and a damage falloff, the
// same shape as the player's gun but wider: 30 body / 85 head at close range,
// halved past 25 m. It fires in bursts of 3-5 with a pause between bursts, and
// it misses the first burst after acquiring a target (reaction), so the player
// has a beat to react. A bot's accuracy is worse while it is moving.
//
// The bot body is the same shape as the starter's target dummy (torso box and
// head sphere) with a team colour, so a hit on the head sphere is a headshot
// and a hit on the torso is a body shot. A downed bot falls over and fades.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

// THE CONSTANTS — every bot number in one place, so difficulty is one
// edit, not a hunt. HEALTH 100 (three rifle body shots, four with the
// falloff); BOT_SPEED 3.4 (slower than the player's 5.2, so the player
// can always disengage); VISION_RANGE 45 and VISION_HALF_ANGLE 0.87 (the
// 100-degree cone); VISION_CHECK 0.15 (the stagger); BURST 3–5 with a
// 0.55 s gap and a 0.13 s shot gap; REACTION 0.45 (the player's beat);
// SPREAD 0.035 + 0.02 moving; DAMAGE 30/85; FALLOFF 25–45 m halved. Change
// one number and the whole difficulty moves with it — that is the point
// of keeping them here instead of in the code.
const HEALTH = 100;
const BOT_SPEED = 3.4;
const BOT_SPRINT = 4.2;
const VISION_RANGE = 45;
const VISION_HALF_ANGLE = 0.87; // ~100 degrees, in radians of half-angle
const VISION_CHECK = 0.15;
const BURST_MIN = 3;
const BURST_MAX = 5;
const BURST_GAP = 0.55;
const SHOT_GAP = 0.13;
const REACTION = 0.45;
const SPREAD = 0.035;
const SPREAD_MOVE = 0.02;
const DAMAGE_BODY = 30;
const DAMAGE_HEAD = 85;
const FALLOFF_START = 25;
const FALLOFF_END = 45;

const TEAM_COLORS = {
  attackers: new THREE.Color('#e8a33d'),
  defenders: new THREE.Color('#4a7fb5'),
};

export function createBots(scene, colliders, shootables, random) {
  const raycaster = new THREE.Raycaster();
  raycaster.far = VISION_RANGE;
  const eye = new THREE.Vector3();
  const toEnemy = new THREE.Vector3();
  const forward = new THREE.Vector3();

  const headMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.45, metalness: 0.1 });
  const standMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.85 });
  const torsoGeometry = new THREE.BoxGeometry(0.52, 0.78, 0.3);
  const headGeometry = new THREE.SphereGeometry(0.155, 16, 12);
  const legGeometry = new THREE.BoxGeometry(0.2, 0.5, 0.2);

  const bots = [];
  const hitMeshes = [];

  // makeBot — build one bot: a group at its spawn with two legs, a torso
// (team colour) and a head (amber), an arm held forward like a rifle, all
// meshes casting and receiving shadows. The torso and head carry userData
// (part + a back-reference to the bot) so a raycast hit can say which bot
// and which part was hit. The bot's route is copied, not shared, so
// rerouting one bot (on plant) never reroutes another. Vision is
// staggered by a random offset so not every bot raycasts on the same step.
function makeBot(team, name, spawn, route) {
    const color = TEAM_COLORS[team];
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.05 });
    const group = new THREE.Group();
    group.position.copy(spawn);

    const legL = new THREE.Mesh(legGeometry, standMaterial);
    legL.position.set(-0.14, 0.25, 0);
    const legR = new THREE.Mesh(legGeometry, standMaterial);
    legR.position.set(0.14, 0.25, 0);
    const torso = new THREE.Mesh(torsoGeometry, mat);
    torso.position.y = 1.0;
    torso.userData.part = 'torso';
    const head = new THREE.Mesh(headGeometry, headMaterial);
    head.position.y = 1.53;
    head.userData.part = 'head';
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.5, 0.1), mat);
    arm.position.set(0.28, 1.0, -0.12);
    arm.rotation.x = -0.9;
    group.add(legL, legR, torso, head, arm);
    group.traverse((mesh) => {
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    scene.add(group);

    const bot = {
      team, name, group, torso, head, legL, legR,
      position: group.position,
      yaw: 0, health: HEALTH, alive: true,
      route: route.slice(), waypoint: 0,
      state: 'move', target: null, seenAt: 0, lastSeen: 0,
      visionTimer: random() * VISION_CHECK,
      burstLeft: 0, shotTimer: 0, burstTimer: 0,
      scanAngle: 0, scanDir: 1,
      fall: 0, walkPhase: 0,
    };
    torso.userData.bot = bot;
    head.userData.bot = bot;
    hitMeshes.push(torso, head);
    bots.push(bot);
    return bot;
  }

  // damage — hurt a bot and say whether it died. Damage is refused on a
// dead bot (a corpse cannot be killed twice, so a grenade and a bullet in
// the same step cannot double-count a kill). On death the bot's state
// becomes dead and its fall animation starts from zero; the caller (main.js)
// owns the kill feed, the money and the sound.
function damage(bot, amount, part) {
    if (!bot.alive) return false;
    bot.health -= amount;
    if (bot.health > 0) return false;
    bot.alive = false;
    bot.state = 'dead';
    bot.fall = 0;
    return true;
  }

  // Line of sight: a ray from the bot's eyes to the enemy's chest, blocked only
  // by the world's shootables (not by other bots). Returns the distance, or -1.
  // lineOfSight — a ray from a position's eyes (y + 1.5) to a target's chest
// (y + 1.2), blocked only by the world's shootables. Returns the distance,
// or −1 when blocked or out of the 45 m vision range. The 0.4 m slack on
// the blocking test keeps a ray that grazes a crate edge from counting as
// blocked — a bot at the edge of cover can still be seen, which is fair,
// because the player can be seen the same way. Only the world blocks: other
// bots never block sight, so a bot can see past a teammate.
function lineOfSight(from, to) {
    eye.set(from.x, from.y + 1.5, from.z);
    toEnemy.set(to.x - eye.x, to.y + 1.2 - eye.y, to.z - eye.z);
    const dist = toEnemy.length();
    if (dist > VISION_RANGE) return -1;
    toEnemy.normalize();
    raycaster.set(eye, toEnemy);
    const hits = raycaster.intersectObjects(shootables, false);
    if (hits.length > 0 && hits[0].distance < dist - 0.4) return -1;
    return dist;
  }

  // canSee — the full vision test: range first (cheap), then the cone (a dot
// product against the bot's forward, compared with cos(0.87) for the
// 100-degree field), then the line-of-sight ray (expensive, and only run
// when the first two pass). Returns the distance, or −1. The order matters:
// the ray is the expensive part, so it runs last and least.
function canSee(bot, enemyPos) {
    const dx = enemyPos.x - bot.position.x;
    const dz = enemyPos.z - bot.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist > VISION_RANGE) return -1;
    forward.set(-Math.sin(bot.yaw), 0, -Math.cos(bot.yaw));
    const dot = (forward.x * dx + forward.z * dz) / (dist || 1);
    if (dot < Math.cos(VISION_HALF_ANGLE)) return -1;
    return lineOfSight(bot.position, enemyPos);
  }

  // The bot's step: move, look, and shoot. Called once per fixed step by main.js.
  // stepBot — one bot's mind, once per fixed step. Dead bots only fall.
// The living scan on a staggered 0.15 s timer and take the first visible
// enemy as their target (re-acquiring every scan, so a bot that loses sight
// drops the target and a bot that gains sight picks it up within 0.15 s).
// In combat the bot faces the target and fires in bursts after the 0.45 s
// reaction delay; the burst counter and the pause between bursts are what
// make bot fire survivable. Out of combat the bot walks its route at
// 3.4 m/s (waypoint reached within 0.6 m) or, at the end of the route,
// holds and scans. The rotate state is not a branch here: main.js rewrites
// the bot's route on plant, and the move branch walks the new route —
// rotation is a route, not a mode.
function stepBot(bot, dt, time, enemies, onShoot) {
    if (!bot.alive) {
      bot.fall = Math.min(1, bot.fall + dt / 0.4);
      bot.group.rotation.x = -bot.fall * 1.45;
      bot.group.position.y = -bot.fall * 0.08;
      return;
    }

    // Vision, staggered so not every bot raycasts every frame.
    bot.visionTimer -= dt;
    if (bot.visionTimer <= 0) {
      bot.visionTimer = VISION_CHECK;
      bot.target = null;
      for (const enemy of enemies) {
        if (!enemy.alive) continue;
        const dist = canSee(bot, enemy.position);
        if (dist >= 0) {
          bot.target = enemy;
          bot.lastSeen = time;
          if (!bot.seenAt) bot.seenAt = time;
          break;
        }
      }
      if (!bot.target) bot.seenAt = 0;
    }

    // Combat: face the target and fire in bursts.
    if (bot.target && bot.target.alive) {
      const dx = bot.target.position.x - bot.position.x;
      const dz = bot.target.position.z - bot.position.z;
      bot.yaw = Math.atan2(-dx, -dz);
      bot.state = 'combat';
      bot.burstTimer -= dt;
      if (time - bot.seenAt > REACTION && bot.burstTimer <= 0) {
        if (bot.burstLeft <= 0) {
          bot.burstLeft = BURST_MIN + Math.floor(random() * (BURST_MAX - BURST_MIN + 1));
          bot.burstTimer = BURST_GAP;
        } else {
          bot.shotTimer -= dt;
          if (bot.shotTimer <= 0) {
            bot.shotTimer = SHOT_GAP;
            bot.burstLeft -= 1;
            if (bot.burstLeft <= 0) bot.burstTimer = BURST_GAP;
            onShoot(bot, bot.target);
          }
        }
      }
      return;
    }

    // Move: walk the route. At the last waypoint, hold and scan.
    if (bot.waypoint < bot.route.length) {
      const wp = bot.route[bot.waypoint];
      const dx = wp.x - bot.position.x;
      const dz = wp.z - bot.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.6) {
        bot.waypoint += 1;
        if (bot.waypoint >= bot.route.length) bot.state = 'hold';
        return;
      }
      bot.yaw = Math.atan2(-dx, -dz);
      const speed = BOT_SPEED;
      bot.position.x += (dx / dist) * speed * dt;
      bot.position.z += (dz / dist) * speed * dt;
      bot.walkPhase += dt * 8;
      bot.state = 'move';
    } else {
      // Hold: scan slowly left and right.
      bot.scanAngle += bot.scanDir * dt * 0.5;
      if (bot.scanAngle > 0.7) bot.scanDir = -1;
      if (bot.scanAngle < -0.7) bot.scanDir = 1;
      bot.yaw += bot.scanDir * dt * 0.5;
      bot.state = 'hold';
    }
  }

  // applyVisuals — the body's pose follows its state: yaw always, legs
// swinging with the walk phase while moving (opposite phases, 0.5 rad
// amplitude), legs reset to zero while holding, fighting or dead. The
// fall animation is not here — stepBot drives rotation.x directly, so a
// dead bot keeps falling even though its state is dead and its legs are
// still. Visuals are kept apart from the mind on purpose: the mind decides
// in stepBot, the body shows it here, and neither can break the other.
function applyVisuals(bot, dt) {
    bot.group.rotation.y = bot.yaw;
    if (bot.state === 'move' && bot.alive) {
      bot.legL.rotation.x = Math.sin(bot.walkPhase) * 0.5;
      bot.legR.rotation.x = -Math.sin(bot.walkPhase) * 0.5;
    } else {
      bot.legL.rotation.x = 0;
      bot.legR.rotation.x = 0;
    }
  }

  return {
    bots,
    hitMeshes,
    makeBot,
    damage,
    stepBot,
    applyVisuals,
    lineOfSight,
    // Bot shooting: a hitscan shot with spread and falloff, resolved by main.js.
    // shotDamage — a bot's damage at a distance: 30 body / 85 head up close,
// halved linearly from 25 m to 45 m. The falloff is what makes a bot
// dangerous up close and a nuisance at range — and what makes the player's
// rifle (no falloff, 90 m range) the long-lane answer to a holding bot.
shotDamage(dist, part) {
      let dmg = part === 'head' ? DAMAGE_HEAD : DAMAGE_BODY;
      if (dist > FALLOFF_START) {
        const t = Math.min(1, (dist - FALLOFF_START) / (FALLOFF_END - FALLOFF_START));
        dmg *= 1 - t * 0.5;
      }
      return dmg;
    },
    // shotSpread — a bot's spread cone: 0.035 rad standing, 0.055 rad moving.
// Moving bots shoot worse, so a bot pushing a lane is less accurate than
// one holding an angle — the same rule the player's spread follows, with
// wider numbers, because a bot that shot like a player would be
// unbeatable.
shotSpread(moving) {
      return SPREAD + (moving ? SPREAD_MOVE : 0);
    },
    // reset — restore every bot for a new round. NOTE: no caller uses this
// today — main.js's resetRoundPositions performs the reset inline with
// fresh routes. It is kept so the module exposes a complete reset
// operation: alive, full health, moving, waypoint zero, no target, no
// fall, upright, back at its spawn. The spawn list is positional: bot i
// goes to spawns[i], so the caller must pass spawns in creation order.
reset(spawns) {
      for (let i = 0; i < bots.length; i += 1) {
        const bot = bots[i];
        bot.alive = true;
        bot.health = HEALTH;
        bot.state = 'move';
        bot.waypoint = 0;
        bot.target = null;
        bot.seenAt = 0;
        bot.fall = 0;
        bot.group.rotation.set(0, bot.yaw, 0);
        bot.group.position.y = 0;
        if (spawns && spawns[i]) bot.position.copy(spawns[i]);
      }
    },
    // aliveCount — how many bots of a team are still alive. main.js adds the
// player for the attackers (the player is the fourth attacker) and reads
// this every step for the alive counts and the elimination check.
aliveCount(team) {
      return bots.filter((b) => b.team === team && b.alive).length;
    },
  };
}
