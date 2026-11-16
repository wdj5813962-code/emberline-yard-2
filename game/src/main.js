// ARCHITECTURE — how the pieces fit together.
//
//   main.js    boot, the fixed-step loop, shooting, grenades, the bomb, shot mode.
//   world.js   the map: geometry, colliders, shootables, sites, spawns, bot routes.
//   input.js   keyboard/mouse, pointer lock, edge-triggered keys.
//   player.js  movement: accel, friction, gravity, crouch/jump, axis-separated collision.
//   weapon.js  five weapons: stats, view models, spread/bloom, reload, zoom, grenades.
//   bots.js    seven bots: routes, vision, burst fire, rotation, death animation.
//   rounds.js  the match state machine: buy -> live -> end, money, the bomb timers.
//   hud.js     the DOM HUD: push-only setters with caching, overlay and buy menu.
//   audio.js   synthesized Web Audio: no audio files, lazy AudioContext.
//
// THE LOOP. The simulation runs at a fixed 60 Hz and rendering runs at the
// display's rate. frame() accumulates real time, runs step() in 1/60 s slices
// (at most 5 per frame, with the accumulator clamped so a slow frame cannot
// spiral), then renders. step() moves the player, the bots, the grenades and
// the bomb, and updates the HUD numbers. Nothing in step() or frame() allocates
// in the hot loop: the raycaster, the direction/muzzle/hitPoint vectors and the
// 12 tracers are allocated once at the top and reused, and bot vision raycasts
// are staggered at most every 0.15 s per bot. The only per-event allocations
// are a grenade mesh on throw and the short-lived explosion flash.
//
// DETERMINISM. One seeded RNG (mulberry32, seed from ?seed=) drives weapon
// spread, recoil jitter, bot burst lengths and bot vision staggering, so the
// same seed replays the same capture. Shot mode (?shot=start|play|end) runs
// settle() — a fixed number of step() calls with no rendering — then paints
// twice and freezes, setting window.__shotReady. A capture is therefore a
// deterministic frame, not a lucky one.
//
// TEAMS. The player is the fourth attacker. Three attacker bots push the
// lanes on waypoint routes; four defender bots hold the sites. Each bot's
// enemies are the opposing team's bots plus the player (defenders only: an
// attacker bot never shoots the player, because the player is on its team).
// Bot-vs-bot damage and player damage are both resolved by raycast in
// botShoot, so a bot can kill another bot and the kill feed stays honest.
//
// SHOOTING. The player's shot is a hitscan ray from the camera with spread
// from weapon.spread (movement + bloom). It tests shootables (world boxes and
// the floor) plus the bots' torso/head meshes; a head sphere hit is a
// headshot. A tracer line is pooled from muzzle to hit point. Bot shots use
// the same shape with a wider spread cone and damage falloff past 25 m.
//
// THE BOMB. Only the player plants (holding E inside a site, 3 s channel).
// While planted the round timer stops and the 35 s bomb timer runs; defenders
// are rerouted to the planted site and a defender standing beside the bomb
// defuses it (5 s channel). Detonation, defuse, elimination or timeout ends
// the round; money is paid out and the next buy phase starts. First to 5.
//
// HUD AND AUDIO. main.js pushes numbers into hud.js and reads callbacks out
// (buy clicks, play clicks); hud.js never touches the simulation. Every HUD
// setter caches its last value and skips the DOM write when nothing changed.
// Audio is synthesized with Web Audio on first user gesture; there are no
// audio files to fetch, so the game never waits on the network for a sound.
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

// BOOT SEQUENCE — everything below runs once, in order, before the first
// frame. Renderer (antialias, pixel ratio capped at 2, PCF soft shadows),
// scene (warm background and fog), camera (74° FOV, 0.05–140 m), world,
// audio, HUD, rounds, player, weapon, input, bots. Then the shared
// raycaster and scratch vectors, the bomb mesh (hidden), the grenade
// pool's geometry and material, and the 12-line tracer pool. Then the
// teams: three attacker bots and four defender bots, wired to spawns and
// routes. Then the player's own state (health, alive, primary, grenades,
// kills, deaths) and the combined shootables list (world plus bot meshes).
// Finally the camera sync, the match start, and either the capture (shot
// mode) or the frame loop. Boot is deliberately linear: there is no async
// work, no fetch, nothing that can arrive late and leave the game half
// built.
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

// spawnTracer — fire one pooled tracer from muzzle to hit point: take the
// next line in the ring (12 lines, reused round-robin), write its two
// endpoints, show it for 0.06 s. The pool is fixed so a firefight cannot
// allocate; the 13th tracer reuses the 1st, which is fine, because a
// tracer lives only 0.06 s and 12 concurrent tracers is more than the
// game's fire rate can produce.
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
// The seven bots are named, not numbered, so the kill feed reads like a
// match ("You eliminated Juno") instead of a log ("bot 3 eliminated bot
// 5"). Attackers: Vex and Rook push the lanes, Iris pushes mid. Defenders:
// Hale and Moss hold A, Juno and Kade hold B. The names are short,
// distinct, and pronounceable — a feed line is read at a glance,
// mid-fight, so a name that takes a second to parse is a name that fails.
// The player takes spawn [0]; the three attacker bots take [1..3]. The
// defender list is four bots, two per site, so each site starts defended.
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

// The player's own state: health (100, the only number that matters),
// alive, the primary weapon id, grenades (0 to start — grenades are
// bought, not given), kills and deaths. The player is a plain object,
// not a class: the player has no behaviour of its own, only state, and
// main.js is the behaviour. The weapon and the body live beside it —
// weapon owns the gun, body owns the position, self owns the match facts.
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
let accumulator = 0;
let lastTime = performance.now();
let beepTimer = 0;
let stepTimer = 0;

// siteAt — which bomb site, if any, a position stands in. A plant only
// counts inside a site's 4.5 m radius, measured on the ground plane (x/z
// only: height does not matter, so planting from on top of a crate inside
// the site still counts, and the radius is generous enough that the channel
// rarely fails on positioning). Returns the site object or null.
function siteAt(pos) {
  for (const key of Object.keys(SITES)) {
    const site = SITES[key];
    const dx = pos.x - site.center.x;
    const dz = pos.z - site.center.z;
    if (dx * dx + dz * dz < site.radius * site.radius) return site;
  }
  return null;
}

// resetRoundPositions — put every actor back at its spawn for a new round.
// The player goes to attackers[0] with zero velocity, level aim and full
// health, and re-equips the primary (or the pistol) with a full refill, so
// a new round never inherits a half-empty magazine. Each bot is restored
// alive with full health, a fresh route (attackers push, defenders hold),
// its waypoint reset and its fall animation cleared. The bomb is hidden,
// live grenades are removed from the scene, and the tracer pool is cleared.
// Bots are reset from starts[] (attacker and defender spawns in team order);
// the per-bot route list is restored from ROUTES so a defender that rotated
// last round holds its site again.
function resetRoundPositions() {
  body.position.copy(SPAWNS.attackers[0]);
  body.velocity.set(0, 0, 0);
  body.yaw = 0;
  body.pitch = 0;
  self.health = PLAYER_HEALTH;
  self.alive = true;
  weapon.equip(self.primary || 'pistol');
  weapon.refill();
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

// startMatch — reset the whole match: rounds, money, score, the player's
// primary and grenades, kills and deaths, positions, and every HUD number.
// Called once at boot and again from the match-end overlay's "Play again".
// The buy menu opens immediately, so the first decision the player makes
// is what to buy with $800 — the pistol round.
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

// endRoundCheck — the elimination end condition, checked every step while
// the round is live. If no defender is alive, the attackers win; if no
// attacker is alive (player included) and the bomb is not planted, the
// defenders win. A planted bomb suspends the elimination loss: the round
// is not over while the bomb ticks, because the defenders can still win by
// defusing and the attackers by detonation. onRoundEnd pays out, banners
// the reason and shows the match overlay when the match is over.
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

// onRoundEnd — what happens the moment a round is decided: the win or
// loss arpeggio, a banner naming the winner and the reason, the score and
// money pushed to the HUD, the buy menu hidden, and — if that was the
// fifth round — the match overlay with the final score and pointer lock
// released. The next round starts from step(), not from here: the end
// phase runs a 4 s timer and then calls nextRound + resetRoundPositions.
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

// onLockChange — pointer lock is the game's pause button. Gaining the lock
// starts play (hides the overlay, ensures audio) and losing it pauses: the
// overlay returns, unless the round just ended (then the end phase, not a
// pause, owns the screen) or the match is over. Shot mode ignores lock
// entirely — captures run without a user, so a lock change must never show
// an overlay over a frozen capture frame.
function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    hud.hideOverlay();
    audio.ensure();
  } else if (rounds.state.phase !== 'end' || rounds.state.matchOver) {
    hud.showOverlay(rounds.state.matchOver ? 'matchEnd' : 'paused', rounds.state.matchOver ? `Final score ${rounds.state.score.attackers} — ${rounds.state.score.defenders}.` : undefined);
  }
}

// syncCamera — put the camera where the player's eyes are: position plus
// eye height (which lerps on crouch), rotation from pitch/yaw in YXZ order
// so yaw turns the body and pitch nods the head without rolling. Called
// every frame and once per capture paint, so the frozen capture frame and
// the live game always agree on the view.
function syncCamera() {
  camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
  camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
}

// aimAt — point the player's view at a world point (used by shot mode to
// aim at a defender). Yaw comes from the x/z direction, pitch from the
// vertical angle, both clamped by the same limits as mouse look. The camera
// is synced immediately so the next paint shows the aim.
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
// playerShoot — one trigger pull, start to finish. Take a round from the
// magazine (an empty magazine clicks instead of firing); take the camera's
// forward direction and perturb it by the weapon's spread (movement plus
// bloom, jittered by the seeded RNG); raycast against the world and the
// bots out to the weapon's range; spawn a pooled tracer from the muzzle to
// the hit point (or to max range on a miss); resolve a bot hit as a body or
// headshot, pay kill money and feed the kill, or — on a non-lethal hit —
// turn the bot toward the shooter and mark the hit; then kick the view
// model, recoil the camera, play the shot, and push ammo and crosshair gap
// to the HUD. Semi-auto weapons clear the firing flag in frame(), so one
// click is one shot; automatic weapons keep firing while held.
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

// botShoot — one bot's shot at its target. The ray starts at the bot's
// head height (y + 1.5) and aims at the target's chest (y + 1.2) with the
// bot spread cone (wider while moving), out to 60 m. A tracer is pooled
// from the muzzle. If the ray hits a bot first, that bot takes falloff
// damage (head or torso) and the kill is fed; if it hits the world, the
// shot stops there — bots cannot shoot through walls. The player is hit
// only when the target is the player AND the hit point lands within 0.45 m
// of the player's centre line between ankle and head (head above 1.4 m):
// the ray may have hit a wall beside the player, so the proximity test is
// what actually decides a player hit. Every bot shot plays the distant
// enemy-shot sound, so the player hears firefights as well as seeing them.
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

// damagePlayer — the player takes damage: health drops, the HUD and the
// damage flash update, the hurt sound plays, and at zero the player is
// down (deaths + 1, the player target dies so bots stop shooting at the
// body, a feed line names the killer, a banner says the team fights on,
// pointer lock is released and the round is re-checked — the team may
// still win without the player). Damage is ignored once the player is
// already down, so a dead player cannot be killed twice by one grenade.
function damagePlayer(amount, source) {
  if (!self.alive) return;
  self.health -= amount;
  hud.setHealth(self.health);
  hud.damageFlash();
  // Show where the damage came from: the angle from the player's facing
  // to the threat, as a red marker on a ring around the crosshair. A
  // grenade has no source, so it flashes without a direction.
  if (source) {
    const dx = source.position.x - body.position.x;
    const dz = source.position.z - body.position.z;
    hud.showDamageDirection(Math.atan2(-dx, -dz) - body.yaw);
  }
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
// throwGrenade — spend one grenade from the inventory and launch it: a
// small dark sphere from the muzzle, thrown along the camera direction at
// 16 m/s plus 4 m/s up, with a 2 s fuse. The throw plays the SMG shot
// sound (the closest synthesized sound to a throw) and the grenade is
// stepped by stepGrenades until its fuse runs out.
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

// stepGrenades — fly every live grenade one step: gravity pulls at 18
// (slightly less than the player's 20, so a throw arcs flat), and a bounce
// is a reflection of the dominant velocity component at 0.4 (the grenade
// loses energy each bounce and never gains it). The floor is special: a
// grenade that dips below 0.07 m is set back onto it and damped (0.7 on
// the horizontal axes), so grenades roll to a stop instead of jittering
// through the floor. At fuse zero the grenade explodes where it is.
// The probe box is 0.07 m half-size, the grenade's own radius, so a bounce
// is tested against the grenade's body and not its centre.
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

// explodeGrenade — the blast: an expanding amber sphere that grows and
// fades over ~0.3 s (a setInterval, not the fixed step, because the flash
// is cosmetic and does not affect the simulation), plus damage. Damage is
// 80 at 1 m falling linearly to 10 at 6 m, floored at 10, and only with
// line of sight past 1.5 m — a bot behind a wall at 3 m takes nothing,
// while a bot in the open at 3 m takes the blast. The player takes the
// same blast at 0.6×, so a grenade at the player's own feet hurts but
// rarely kills outright from full health.
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
// stepBomb — the objective, every step while the round is live. Planting:
// holding E inside a site advances the 3 s channel (the plant bar shows
// the progress); leaving the site or releasing E resets it. A completed
// plant puts the bomb mesh on the site pad, starts the 35 s timer, pays
// the plant bonus, banners the plant, and reroutes every living defender
// to the planted site. While planted: the bomb beeps (every 1 s, every
// 0.5 s under 10 s) and its light blinks; a defender standing within 1.6 m
// of the bomb defuses on a 5 s channel (the plant bar shows the defuser's
// name); at zero the bomb detonates and the attackers win. The player
// defuses nothing — defusing is the defenders' job, and the player is an
// attacker.
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
// buy — spend money in the buy phase. Grenades are consumable (each $300
// adds one to the inventory); weapons are bought once per match (OWNED
// tracks them, so a rifle bought in round one stays bought) and equipping
// one refills it. Buying is refused outside the buy phase, without the
// money, or for a weapon already owned — the menu cannot sell what the
// player cannot use. Every successful buy plays the buy chime and pushes
// money and ammo to the HUD.
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
// step — one 1/60 s slice of the simulation. The round timer runs first
// (buy 15 s, live 100 s, end 4 s), then the player moves (only while live
// and alive, with a footstep every 0.38 s above 1 m/s), then every bot
// steps with its enemies (defenders see the player and the attacker bots;
// attackers see only the defender bots), then the weapon, grenades and
// bomb step, tracers fade, the round is re-checked for elimination, and
// the alive counts are pushed to the HUD. Dead bots still step — with no
// enemies — so their fall animation plays out.
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

// frame — the render loop, called by requestAnimationFrame. While not
// frozen it reads the mouse look, switches weapons on 1/2/3 (primary only
// if bought, pistol always, grenade only if carried), applies the sniper
// zoom (30° FOV while right-clicking), throws on G, toggles the buy menu
// on B (buy phase only, releasing pointer lock so the menu can be
// clicked), fires while held (semi-auto clears the flag after one shot),
// reloads on R, and then runs the fixed steps (at most 5, accumulator
// clamped) and syncs the camera. The render happens every call, frozen or
// not, so a frozen capture frame keeps painting the same image.
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

// settle — run the simulation forward a fixed number of steps with no
// rendering. Shot mode uses it to put the world into a mid-round state
// (bots walked out, shots fired) before the first paint, so a capture is
// a scene, not a spawn frame. It is also the whole determinism story: the
// same seed plus the same settle count is the same frame.
function settle(steps) {
  for (let index = 0; index < steps; index += 1) step(FIXED_STEP);
}

// runShot — build one deterministic capture frame. The overlay and buy
// menu are hidden, the round is forced live with a full timer, and the
// player is levelled. For play/end the player stands in mid yard (0, 0, 8),
// the world settles 30 steps (bots walk out), and the player fires four
// shots at the third defender — the tracer, hitmarker and kill feed are
// therefore real simulation results, not staged overlays. For end the bomb
// is planted at A, the score is set 2–1, money $5400 and health 62, and
// the world settles 20 more steps while defenders rotate. For start the
// player stands at spawn (0, 0, 16), aims down mid, and the buy menu opens
// with $800. Every branch ends by painting twice and freezing.
// SHOT MODE — the entry's demo captures, not gameplay. ?shot=start
// shows the buy menu (round 1, $800, pistol); ?shot=play shows a live
// round (one elimination, a kill feed line, $3250); ?shot=end shows a
// planted bomb at Site A with 62 health. The mode is driven by the URL
// so the same build can be captured three ways without playing: the
// capture script passes ?shot=...&seed=1 and waits for window.__shotReady.
// The end shot's health is set on self.health (not the HUD) because
// runShot ends by writing hud.setHealth(self.health) — a HUD-only write
// would be overwritten with 100.
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
      // Health is set on the player, not the HUD: runShot ends with
      // hud.setHealth(self.health), so a HUD-only write here would be
      // overwritten with 100. Setting self.health makes the 62 stick.
      self.health = 62;
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

// paintTwiceThenReady — render two frames, then freeze and announce the
// capture. Two paints, not one: the first lets the renderer compile and
// the HUD settle, the second is the frame the screenshot takes. Setting
// window.__shotReady tells the capture harness the frame is final; frozen
// stops the simulation (frame() keeps rendering the same image, so the
// capture cannot catch a half-stepped world).
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
