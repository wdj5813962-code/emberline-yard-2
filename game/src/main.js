// Boot and the one loop: a fixed 60 Hz simulation feeding a render at the display's rate.
// ?shot=start|play|end with &seed=N sets up a deterministic frame for a capture, renders it
// twice, then freezes it and sets window.__shotReady.
//
// Emberline Yard: a round-based tactical FPS. The player is the fourth attacker
// against four defenders, with three bot teammates. A round is buy (15 s) ->
// live (100 s) -> end, and the first team to 5 rounds wins the match. The
// objective is the bomb: plant it at A or B and defend it until it detonates,
// or eliminate the defenders. Money buys weapons between rounds.
//
// The simulation is fixed-step (60 Hz) and kept apart from rendering: step()
// moves the player, the bots, the grenades and the bomb, and frame() renders.
// No new objects are made in the hot loop; the vectors and the raycaster are
// allocated once at the top and reused.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createWorld, SITES, SPAWNS, ROUTES } from './world.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createWeapon, WEAPONS } from './weapon.js';
import { createBots } from './bots.js';
import { createRounds, ROUND } from './rounds.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;
const PLAYER_HEALTH = 100;

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#d9a860');
scene.fog = new THREE.Fog(new THREE.Color('#d9a860'), 35, 85);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 140);
scene.add(camera);

const world = createWorld(scene);
const audio = createAudio();
const hud = createHud();
const rounds = createRounds();
const player = createPlayer(world.colliders);
const weapon = createWeapon(camera);
const input = createInput(renderer.domElement, onLockChange);
const bots = createBots(scene, world.colliders, world.shootables, random);

// The raycaster and the scratch vectors: allocated once, reused every shot.
const raycaster = new THREE.Raycaster();
raycaster.far = 120;
const direction = new THREE.Vector3();
const muzzle = new THREE.Vector3();
const hitPoint = new THREE.Vector3();

// The bomb mesh: a small dark box with a blinking light, hidden until planted.
const bombGroup = new THREE.Group();
const bombBody = new THREE.Mesh(
  new THREE.BoxGeometry(0.3, 0.18, 0.2),
  new THREE.MeshStandardMaterial({ color: new THREE.Color('#222222'), roughness: 0.5, metalness: 0.4 }),
);
const bombLight = new THREE.Mesh(
  new THREE.SphereGeometry(0.04, 8, 8),
  new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff2222') }),
);
bombLight.position.set(0, 0.12, 0);
bombGroup.add(bombBody, bombLight);
bombGroup.visible = false;
scene.add(bombGroup);

// Grenades in flight: each has a mesh, a velocity, and a fuse.
const grenades = [];
const grenadeGeometry = new THREE.SphereGeometry(0.07, 10, 8);
const grenadeMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color('#2a2a2a'), roughness: 0.5, metalness: 0.5 });

// Tracers: short-lived lines from muzzle to hit point, pooled and reused.
const tracers = [];
const tracerMaterial = new THREE.LineBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.7 });
for (let i = 0; i < 12; i += 1) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const line = new THREE.Line(geometry, tracerMaterial);
  line.visible = false;
  line.frustumCulled = false;
  scene.add(line);
  tracers.push({ line, life: 0 });
}
let tracerIndex = 0;

function spawnTracer(from, to) {
  const t = tracers[tracerIndex];
  tracerIndex = (tracerIndex + 1) % tracers.length;
  const pos = t.line.geometry.attributes.position;
  pos.setXYZ(0, from.x, from.y, from.z);
  pos.setXYZ(1, to.x, to.y, to.z);
  pos.needsUpdate = true;
  t.line.visible = true;
  t.life = 0.06;
}

// --- Teams and bots -------------------------------------------------------
const attackerBots = [];
const defenderBots = [];
{
  // Three attacker teammates: two push A, one pushes B (or mid).
  attackerBots.push(bots.makeBot('attackers', 'Vex', SPAWNS.attackers[1], ROUTES.toA));
  attackerBots.push(bots.makeBot('attackers', 'Rook', SPAWNS.attackers[2], ROUTES.toB));
  attackerBots.push(bots.makeBot('attackers', 'Iris', SPAWNS.attackers[3], ROUTES.toMid));
  // Four defenders: two hold A, two hold B.
  defenderBots.push(bots.makeBot('defenders', 'Hale', SPAWNS.defenders[0], ROUTES.defA));
  defenderBots.push(bots.makeBot('defenders', 'Moss', SPAWNS.defenders[1], ROUTES.defA));
  defenderBots.push(bots.makeBot('defenders', 'Juno', SPAWNS.defenders[2], ROUTES.defB));
  defenderBots.push(bots.makeBot('defenders', 'Kade', SPAWNS.defenders[3], ROUTES.defB));
}
const allBots = attackerBots.concat(defenderBots);

// The player's own state, kept in one place.
const self = {
  health: PLAYER_HEALTH,
  alive: true,
  primary: null, // 'rifle' | 'smg' | 'sniper' | null
  grenades: 0,
  kills: 0,
  deaths: 0,
};
const body = player.state;
const shootables = world.shootables.concat(bots.hitMeshes);

let elapsed = 0;
let frozen = false;
let started = false;
let accumulator = 0;
let lastTime = performance.now();
let roundStarted = false;
let beepTimer = 0;
let stepTimer = 0;

function siteAt(pos) {
  for (const key of Object.keys(SITES)) {
    const site = SITES[key];
    const dx = pos.x - site.center.x;
    const dz = pos.z - site.center.z;
    if (dx * dx + dz * dz < site.radius * site.radius) return site;
  }
  return null;
}

function resetRoundPositions() {
  body.position.copy(SPAWNS.attackers[0]);
  body.velocity.set(0, 0, 0);
  body.yaw = 0;
  body.pitch = 0;
  self.health = PLAYER_HEALTH;
  self.alive = true;
  weapon.equip(self.primary || 'pistol');
  weapon.refill();
  const spawns = [];
  for (const bot of allBots) spawns.push(bot.group.position.clone());
  // Reset bots to their spawn positions with fresh routes.
  const atkSpawns = [SPAWNS.attackers[1], SPAWNS.attackers[2], SPAWNS.attackers[3]];
  const defSpawns = [SPAWNS.defenders[0], SPAWNS.defenders[1], SPAWNS.defenders[2], SPAWNS.defenders[3]];
  const routes = [ROUTES.toA, ROUTES.toB, ROUTES.toMid, ROUTES.defA, ROUTES.defA, ROUTES.defB, ROUTES.defB];
  const starts = atkSpawns.concat(defSpawns);
  for (let i = 0; i < allBots.length; i += 1) {
    const bot = allBots[i];
    bot.alive = true;
    bot.health = 100;
    bot.state = 'move';
    bot.waypoint = 0;
    bot.route = routes[i].slice();
    bot.target = null;
    bot.seenAt = 0;
    bot.fall = 0;
    bot.group.rotation.set(0, 0, 0);
    bot.group.position.y = 0;
    bot.position.copy(starts[i]);
  }
  bombGroup.visible = false;
  for (const g of grenades) scene.remove(g.mesh);
  grenades.length = 0;
  for (const t of tracers) {
    t.line.visible = false;
    t.life = 0;
  }
}

function startMatch() {
  rounds.resetMatch();
  self.primary = null;
  self.grenades = 0;
  self.kills = 0;
  self.deaths = 0;
  resetRoundPositions();
  hud.setHealth(self.health);
  hud.setMoney(rounds.state.money);
  hud.setScore(0, 0);
  hud.setAlive(4, 4);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve);
  hud.setWeapon(WEAPONS.pistol.name);
  hud.showBuy(true);
}

function endRoundCheck() {
  if (rounds.state.phase !== 'live') return;
  const atkAlive = bots.aliveCount('attackers') + (self.alive ? 1 : 0);
  const defAlive = bots.aliveCount('defenders');
  if (defAlive === 0) {
    rounds.endRound('attackers', 'Defenders eliminated');
    onRoundEnd();
  } else if (atkAlive === 0) {
    if (rounds.state.planted) {
      // The bomb is still ticking; defenders must defuse or it detonates.
      return;
    }
    rounds.endRound('defenders', 'Attackers eliminated');
    onRoundEnd();
  }
}

function onRoundEnd() {
  const st = rounds.state;
  if (st.winner === 'attackers') audio.roundWin();
  else audio.roundLose();
  hud.showBanner(st.winner === 'attackers' ? `Round won — ${st.endReason}` : `Round lost — ${st.endReason}`, 3500);
  hud.setScore(st.score.attackers, st.score.defenders);
  hud.setMoney(st.money);
  hud.showBuy(false);
  if (st.matchOver) {
    hud.showOverlay('matchEnd', `Final score ${st.score.attackers} — ${st.score.defenders}. ${st.winner === 'attackers' ? 'Your team takes the match.' : 'The defenders take the match.'}`);
    if (document.pointerLockElement) document.exitPointerLock();
  }
}

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    hud.hideOverlay();
    audio.ensure();
  } else if (rounds.state.phase !== 'end' || rounds.state.matchOver) {
    hud.showOverlay(rounds.state.matchOver ? 'matchEnd' : 'paused', rounds.state.matchOver ? `Final score ${rounds.state.score.attackers} — ${rounds.state.score.defenders}.` : undefined);
  }
}

function syncCamera() {
  camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
  camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
}

function aimAt(point) {
  const dx = point.x - body.position.x;
  const dy = point.y - (body.position.y + body.eye);
  const dz = point.z - body.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

// --- Shooting -------------------------------------------------------------
function playerShoot() {
  if (!weapon.takeRound()) {
    audio.empty();
    return false;
  }
  const w = weapon.current();
  camera.getWorldDirection(direction);
  const spread = weapon.spread(player.groundSpeed());
  direction.x += (random() * 2 - 1) * spread;
  direction.y += (random() * 2 - 1) * spread;
  direction.z += (random() * 2 - 1) * spread;
  direction.normalize();
  camera.getWorldPosition(muzzle);
  muzzle.addScaledVector(direction, 0.5);
  scene.updateMatrixWorld(true);
  raycaster.set(camera.position, direction);
  raycaster.far = w.range;
  const hit = raycaster.intersectObjects(shootables, false)[0];
  const end = hit ? hit.point : camera.position.clone().addScaledVector(direction, w.range);
  spawnTracer(muzzle, end);
  if (hit) {
    hitPoint.copy(hit.point);
    const bot = hit.object.userData.bot;
    if (bot && bot.alive) {
      const part = hit.object.userData.part || 'torso';
      const dmg = part === 'head' ? w.damageHead : w.damageBody;
      const killed = bots.damage(bot, dmg, part);
      if (killed) {
        self.kills += 1;
        rounds.addKillMoney();
        hud.setMoney(rounds.state.money);
        hud.feed(`You eliminated ${bot.name} (${bot.team})`);
        audio.kill();
      } else {
        audio.hit();
        // Being shot turns the bot toward the shooter.
        bot.hearing = body.position;
        bot.target = { position: body.position, alive: true };
        bot.seenAt = elapsed;
        bot.lastSeen = elapsed;
      }
      hud.hitMarker(killed, 90);
    }
  }
  weapon.pullTrigger();
  player.recoil(w.kick + random() * 0.004, (random() * 2 - 1) * 0.004);
  audio.shot(w.id);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve);
  hud.setCrosshairGap(2 + weapon.spread(player.groundSpeed()) * 400);
  return true;
}

function botShoot(bot, target) {
  // A bot's shot: from its head toward the target's chest, with spread.
  const from = bot.position;
  const to = target.position;
  const dx = to.x - from.x;
  const dy = (to.y + 1.2) - (from.y + 1.5);
  const dz = to.z - from.z;
  const dist = Math.hypot(dx, dy, dz) || 1;
  const spread = bots.shotSpread(bot.state === 'move');
  direction.set(
    dx / dist + (random() * 2 - 1) * spread,
    dy / dist + (random() * 2 - 1) * spread,
    dz / dist + (random() * 2 - 1) * spread,
  ).normalize();
  muzzle.set(from.x, from.y + 1.5, from.z);
  scene.updateMatrixWorld(true);
  raycaster.set(muzzle, direction);
  raycaster.far = 60;
  const hit = raycaster.intersectObjects(shootables, false)[0];
  const end = hit ? hit.point : muzzle.clone().addScaledVector(direction, 60);
  spawnTracer(muzzle, end);
  if (!hit) return;
  const hitBot = hit.object.userData.bot;
  if (hitBot && hitBot.alive && hitBot !== bot) {
    const part = hit.object.userData.part || 'torso';
    const dmg = bots.shotDamage(dist, part);
    const killed = bots.damage(hitBot, dmg, part);
    if (killed) {
      const who = hitBot.team === 'attackers' && hitBot !== bot ? hitBot.name : hitBot.name;
      hud.feed(`${bot.name} eliminated ${hitBot.name}`);
    }
    return;
  }
  // Did it hit the player?
  if (target === playerTarget) {
    // The player's hitbox: a vertical capsule approximated by a ray-vs-box test.
    // The ray already hit something; if that something is the player we check
    // the distance to the player's body. The player is hit when the ray passes
    // within 0.45 m of the player's centre line below the head.
    const px = body.position.x;
    const pz = body.position.z;
    const py = body.position.y;
    // Re-test: is the hit point near the player?
    const hx = hit.point.x - px;
    const hz = hit.point.z - pz;
    const hy = hit.point.y - py;
    if (hx * hx + hz * hz < 0.45 * 0.45 && hy > 0 && hy < 1.75) {
      const part = hy > 1.4 ? 'head' : 'torso';
      const dmg = bots.shotDamage(dist, part);
      damagePlayer(dmg, bot);
    }
  }
  audio.enemyShot();
}

// A stable object the bots aim at when they target the player.
const playerTarget = { position: body.position, alive: true };

function damagePlayer(amount, source) {
  if (!self.alive) return;
  self.health -= amount;
  hud.setHealth(self.health);
  hud.damageFlash();
  audio.hurt();
  if (self.health <= 0) {
    self.health = 0;
    self.alive = false;
    self.deaths += 1;
    playerTarget.alive = false;
    hud.feed(`${source ? source.name : 'Enemy'} eliminated you`);
    hud.showBanner('You are down. Your team fights on.', 3000);
    if (document.pointerLockElement) document.exitPointerLock();
    endRoundCheck();
  }
}

// --- Grenades ---------------------------------------------------------------
function throwGrenade() {
  if (self.grenades <= 0 || !weapon.useGrenade()) return;
  camera.getWorldDirection(direction);
  const mesh = new THREE.Mesh(grenadeGeometry, grenadeMaterial);
  mesh.castShadow = true;
  camera.getWorldPosition(muzzle);
  mesh.position.copy(muzzle).addScaledVector(direction, 0.4);
  scene.add(mesh);
  grenades.push({
    mesh,
    vel: direction.clone().multiplyScalar(16).add(new THREE.Vector3(0, 4, 0)),
    fuse: 2.0,
    bounced: false,
  });
  audio.shot('smg');
}

function stepGrenades(dt) {
  for (let i = grenades.length - 1; i >= 0; i -= 1) {
    const g = grenades[i];
    g.fuse -= dt;
    g.vel.y -= 18 * dt;
    const next = g.mesh.position.clone().addScaledVector(g.vel, dt);
    // Simple bounce: if the next position is inside a collider, reflect.
    let bounced = false;
    const probe = new THREE.Box3();
    probe.min.set(next.x - 0.07, next.y - 0.07, next.z - 0.07);
    probe.max.set(next.x + 0.07, next.y + 0.07, next.z + 0.07);
    for (const c of world.colliders) {
      if (probe.intersectsBox(c)) {
        // Reflect the dominant velocity component.
        if (Math.abs(g.vel.y) > Math.abs(g.vel.x) && Math.abs(g.vel.y) > Math.abs(g.vel.z)) g.vel.y *= -0.4;
        else if (Math.abs(g.vel.x) > Math.abs(g.vel.z)) g.vel.x *= -0.4;
        else g.vel.z *= -0.4;
        bounced = true;
        break;
      }
    }
    if (!bounced) g.mesh.position.copy(next);
    if (g.mesh.position.y < 0.07) {
      g.mesh.position.y = 0.07;
      g.vel.y = Math.abs(g.vel.y) * 0.4;
      g.vel.x *= 0.7;
      g.vel.z *= 0.7;
    }
    if (g.fuse <= 0) {
      explodeGrenade(g.mesh.position);
      scene.remove(g.mesh);
      grenades.splice(i, 1);
    }
  }
}

function explodeGrenade(pos) {
  audio.explosion();
  // Flash + a quick expanding ring (a scaled sphere that fades).
  const flash = new THREE.Mesh(
    new THREE.SphereGeometry(1, 12, 10),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.6 }),
  );
  flash.position.copy(pos);
  scene.add(flash);
  let scale = 0.1;
  const grow = setInterval(() => {
    scale += 0.5;
    flash.scale.setScalar(scale);
    flash.material.opacity = Math.max(0, 0.6 - scale * 0.12);
    if (scale > 5) {
      clearInterval(grow);
      scene.remove(flash);
    }
  }, 30);
  // Damage: 80 at 1 m falling to 10 at 6 m, only with line of sight.
  const targets = allBots.concat([null]);
  for (const bot of allBots) {
    if (!bot.alive) continue;
    const d = bot.position.distanceTo(pos);
    if (d > 6) continue;
    const los = bots.lineOfSight(pos, bot.position);
    if (los < 0 && d > 1.5) continue;
    const dmg = 80 - ((d - 1) / 5) * 70;
    const killed = bots.damage(bot, Math.max(10, dmg), 'torso');
    if (killed) hud.feed(`Grenade eliminated ${bot.name}`);
  }
  const pd = body.position.distanceTo(pos);
  if (pd <= 6 && self.alive) {
    const dmg = 80 - ((pd - 1) / 5) * 70;
    damagePlayer(Math.max(10, dmg) * 0.6, null);
  }
}

// --- Bomb -------------------------------------------------------------------
function stepBomb(dt) {
  const st = rounds.state;
  if (st.phase !== 'live') return;
  const planting = input.state.keys.has('KeyE') && self.alive && !st.planted;
  const site = planting ? siteAt(body.position) : null;
  if (planting && site) {
    st.plantProgress += dt / ROUND.PLANT_SECONDS;
    hud.showPlant(`Planting at Site ${site.name}…`, st.plantProgress);
    if (st.plantProgress >= 1) {
      rounds.plant(site.name);
      bombGroup.position.set(site.center.x, 0.1, site.center.z);
      bombGroup.visible = true;
      audio.plant();
      hud.showBanner(`Bomb planted at Site ${site.name}! Defend it.`, 3500);
      hud.setBomb(`BOMB PLANTED — Site ${site.name}`);
      hud.hidePlant();
      // Defenders rotate to the planted site.
      for (const bot of defenderBots) {
        if (!bot.alive) continue;
        const other = site.name === 'A' ? ROUTES.rotateBA : ROUTES.rotateAB;
        bot.route = other.slice();
        bot.waypoint = 0;
        bot.state = 'move';
      }
    }
  } else {
    if (st.plantProgress > 0 && !st.planted) {
      st.plantProgress = 0;
      hud.hidePlant();
    }
  }

  if (st.planted) {
    st.bombTimer -= dt;
    beepTimer -= dt;
    if (beepTimer <= 0) {
      beepTimer = st.bombTimer < 10 ? 0.5 : 1.0;
      audio.beep();
      bombLight.material.color.setHex(bombLight.material.color.getHex() === 0xff2222 ? 0xffffff : 0xff2222);
    }
    hud.setTimer(st.bombTimer, 'Bomb');
    // A defender defusing: hold E beside the bomb.
    let defuser = null;
    for (const bot of defenderBots) {
      if (!bot.alive) continue;
      if (bot.position.distanceTo(bombGroup.position) < 1.6) {
        defuser = bot;
        break;
      }
    }
    if (defuser) {
      st.defuseProgress += dt / ROUND.DEFUSE_SECONDS;
      hud.showPlant(`${defuser.name} is defusing…`, st.defuseProgress);
      if (st.defuseProgress >= 1) {
        bombGroup.visible = false;
        audio.defuse();
        hud.hidePlant();
        hud.setBomb('');
        rounds.defused();
        onRoundEnd();
      }
    } else if (st.defuseProgress > 0) {
      st.defuseProgress = 0;
      hud.hidePlant();
    }
    if (st.bombTimer <= 0) {
      bombGroup.visible = false;
      audio.explosion();
      hud.setBomb('');
      rounds.detonate();
      onRoundEnd();
    }
  }
}

// --- Buy menu -----------------------------------------------------------------
const OWNED = { rifle: false, smg: false, sniper: false };
function buy(id) {
  const st = rounds.state;
  if (st.phase !== 'buy') return;
  if (id === 'grenade') {
    if (st.money < WEAPONS.grenade.price) return;
    st.money -= WEAPONS.grenade.price;
    self.grenades += 1;
    weapon.addGrenade();
    audio.buy();
    hud.setMoney(st.money);
    return;
  }
  const w = WEAPONS[id];
  if (!w || OWNED[id] || st.money < w.price) return;
  st.money -= w.price;
  OWNED[id] = true;
  self.primary = id;
  weapon.equip(id);
  weapon.refill();
  audio.buy();
  hud.setMoney(st.money);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve);
  hud.setWeapon(w.name);
}

hud.onBuy((id) => buy(id));

// --- The fixed step -----------------------------------------------------------
function step(dt) {
  elapsed += dt;
  const st = rounds.state;

  if (st.phase === 'buy') {
    st.timer -= dt;
    hud.setTimer(st.timer, 'Buy');
    if (st.timer <= 0) {
      rounds.startLive();
      hud.showBuy(false);
      hud.showBanner(`Round ${st.round} — plant the bomb or eliminate the defenders`, 3000);
    }
  } else if (st.phase === 'live') {
    if (!st.planted) {
      st.timer -= dt;
      hud.setTimer(st.timer, 'Round');
      if (st.timer <= 0) {
        rounds.endRound('defenders', 'Time expired');
        onRoundEnd();
      }
    }
  } else if (st.phase === 'end') {
    st.endTimer -= dt;
    if (st.endTimer <= 0) {
      if (st.matchOver) return;
      rounds.nextRound();
      resetRoundPositions();
      hud.setHealth(self.health);
      hud.setMoney(st.money);
      hud.setAlive(4, 4);
      hud.setAmmo(weapon.state.mag, weapon.state.reserve);
      hud.setWeapon(WEAPONS[self.primary || 'pistol'].name);
      hud.setBomb('');
      hud.showBuy(true);
    }
  }

  if (st.phase === 'live' && self.alive) {
    player.step(dt, input.state.keys);
    // Footsteps.
    stepTimer -= dt;
    if (player.groundSpeed() > 1 && stepTimer <= 0) {
      stepTimer = 0.38;
      audio.step();
    }
  }

  // Bots: attackers fight defenders and vice versa. Each bot's enemies are the
  // opposing team's bots plus the player (if the bot is a defender) or the
  // player is on the attackers' side so defenders target the player too.
  for (const bot of allBots) {
    if (!bot.alive) {
      bots.stepBot(bot, dt, elapsed, [], () => {});
      continue;
    }
    const enemies = [];
    if (bot.team === 'defenders') {
      for (const a of attackerBots) if (a.alive) enemies.push({ position: a.position, alive: true, bot: a });
      if (self.alive) enemies.push(playerTarget);
    } else {
      for (const d of defenderBots) if (d.alive) enemies.push({ position: d.position, alive: true, bot: d });
    }
    bots.stepBot(bot, dt, elapsed, enemies, (shooter, target) => {
      if (target === playerTarget) botShoot(shooter, target);
      else if (target.bot) botShoot(shooter, target.bot);
    });
    bots.applyVisuals(bot, dt);
  }

  // Bot-vs-bot damage is resolved inside botShoot via the raycast; the player
  // being hit is checked there too.

  weapon.step(dt);
  stepGrenades(dt);
  stepBomb(dt);

  // Tracers fade.
  for (const t of tracers) {
    if (t.life > 0) {
      t.life -= dt;
      if (t.life <= 0) t.line.visible = false;
    }
  }

  endRoundCheck();
  hud.setAlive(bots.aliveCount('attackers') + (self.alive ? 1 : 0), bots.aliveCount('defenders'));
  playerTarget.alive = self.alive;
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    const look = input.takeLook();
    if (self.alive && rounds.state.phase === 'live') player.look(look.x, look.y);
    // Weapon switching.
    if (input.pressed('Digit1') && self.primary) {
      weapon.equip(self.primary);
      hud.setAmmo(weapon.state.mag, weapon.state.reserve);
      hud.setWeapon(WEAPONS[self.primary].name);
    }
    if (input.pressed('Digit2')) {
      weapon.equip('pistol');
      hud.setAmmo(weapon.state.mag, weapon.state.reserve);
      hud.setWeapon(WEAPONS.pistol.name);
    }
    if (input.pressed('Digit3') && self.grenades > 0) {
      weapon.equip('grenade');
      hud.setAmmo(1, 0);
      hud.setWeapon(WEAPONS.grenade.name);
    }
    // Sniper zoom (right mouse).
    if (weapon.current().zoom) {
      const zoomed = !!input.state.aiming;
      if (zoomed !== weapon.state.zoomed) {
        weapon.setZoomed(zoomed);
        camera.fov = zoomed ? 30 : 74;
        camera.updateProjectionMatrix();
      }
    }
    // Grenade throw.
    if (input.pressed('KeyG') && self.grenades > 0 && weapon.current().id !== 'grenade') {
      throwGrenade();
    }
    // Buy menu toggle.
    if (input.pressed('KeyB') && rounds.state.phase === 'buy') {
      const menu = document.getElementById('buy-menu');
      hud.showBuy(menu.hidden);
      if (!menu.hidden && document.pointerLockElement) document.exitPointerLock();
    }
    // Firing.
    const w = weapon.current();
    if (w.id === 'grenade') {
      if (input.state.firing && self.alive && rounds.state.phase === 'live') {
        throwGrenade();
        weapon.equip(self.primary || 'pistol');
        hud.setAmmo(weapon.state.mag, weapon.state.reserve);
        hud.setWeapon(WEAPONS[self.primary || 'pistol'].name);
        input.state.firing = false;
      }
    } else if (input.state.firing && weapon.ready() && self.alive && rounds.state.phase === 'live') {
      playerShoot();
      if (!w.auto) input.state.firing = false;
    }
    if (input.state.keys.has('KeyR')) weapon.reload();

    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let index = 0; index < steps; index += 1) step(FIXED_STEP);
}

function runShot(name) {
  hud.hideOverlay();
  hud.showBuy(false);
  rounds.state.phase = 'live';
  rounds.state.timer = ROUND.LIVE_SECONDS;
  body.pitch = 0;
  body.yaw = 0;
  if (name === 'play' || name === 'end') {
    // A mid-round firefight: the player is in mid yard, bots are out.
    body.position.set(0, 0, 8);
    settle(30);
    // Fire at a defender to show the tracer, hitmarker and kill feed.
    const target = defenderBots[2];
    aimAt(new THREE.Vector3(target.position.x, target.position.y + 1.2, target.position.z));
    for (let round = 0; round < 4; round += 1) {
      playerShoot();
      settle(6);
    }
    if (name === 'end') {
      // The bomb planted at A, defenders rotating: the end-of-round moment.
      rounds.plant('A');
      bombGroup.position.set(SITES.A.center.x, 0.1, SITES.A.center.z);
      bombGroup.visible = true;
      hud.setBomb('BOMB PLANTED — Site A');
      hud.setScore(2, 1);
      hud.setMoney(5400);
      hud.setHealth(62);
      settle(20);
    } else {
      hud.setMoney(3250);
      hud.setScore(1, 0);
      settle(10);
    }
  } else {
    // Start: the player at spawn, buy menu open, the yard ahead.
    body.position.set(0, 0, 16);
    body.yaw = 0;
    settle(20);
    aimAt(new THREE.Vector3(0, 1.5, -6));
    hud.showBuy(true);
    hud.setMoney(800);
  }
  hud.setHealth(self.health);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve);
  hud.setAlive(bots.aliveCount('attackers') + 1, bots.aliveCount('defenders'));
  paintTwiceThenReady();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

hud.onPlay(() => {
  if (shot) return;
  if (rounds.state.matchOver) {
    startMatch();
    hud.hideOverlay();
    input.requestLock();
    return;
  }
  if (rounds.state.phase === 'end') {
    // Skip the wait: jump to the next round.
    rounds.nextRound();
    resetRoundPositions();
    hud.setHealth(self.health);
    hud.setMoney(rounds.state.money);
    hud.showBuy(true);
  }
  input.requestLock();
});

syncCamera();
startMatch();
if (shot) runShot(shot);
else requestAnimationFrame(frame);
