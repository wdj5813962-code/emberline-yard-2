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

  const bodyMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.6, metalness: 0.05 });
  const headMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.45, metalness: 0.1 });
  const standMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.85 });
  const torsoGeometry = new THREE.BoxGeometry(0.52, 0.78, 0.3);
  const headGeometry = new THREE.SphereGeometry(0.155, 16, 12);
  const legGeometry = new THREE.BoxGeometry(0.2, 0.5, 0.2);

  const bots = [];
  const hitMeshes = [];

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
      hearing: null,
    };
    torso.userData.bot = bot;
    head.userData.bot = bot;
    hitMeshes.push(torso, head);
    bots.push(bot);
    return bot;
  }

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
    shotDamage(dist, part) {
      let dmg = part === 'head' ? DAMAGE_HEAD : DAMAGE_BODY;
      if (dist > FALLOFF_START) {
        const t = Math.min(1, (dist - FALLOFF_START) / (FALLOFF_END - FALLOFF_START));
        dmg *= 1 - t * 0.5;
      }
      return dmg;
    },
    shotSpread(moving) {
      return SPREAD + (moving ? SPREAD_MOVE : 0);
    },
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
    aliveCount(team) {
      return bots.filter((b) => b.team === team && b.alive).length;
    },
  };
}
