// WEAPON BALANCE — the numbers and why.
//
// THE ARSENAL. Five buys, one interface. Each weapon has a role, and the
// price is the role's cost:
//   P9 pistol   — free. The fallback: 26 body / 78 head, 12/36, semi-auto.
//                 A headshot plus a body shot kills; the pistol round is
//                 winnable, which is why the player starts with $800.
//   AR-7 rifle  — $2500. The workhorse: 34 body / 100 head, 30/90, auto.
//                 A headshot kills outright; three body shots kill. The
//                 rifle is the default buy after a won round.
//   VX-9 SMG    — $1500. Fast and close: 24 body / 72 head, 32/96, auto,
//                 0.07 s between shots. Five body shots to kill, but the
//                 fire rate forgives misses. The site-clearing gun.
//   L-88 sniper — $4000. One shot, slow: 90 body / 180 head, 5/15, bolt.
//                 A body shot nearly kills; a headshot always kills. The
//                 zoom (30° FOV on right-click) and the 1.1 s fire gap are
//                 the price of that power, and it cannot fire accurately
//                 while moving fast (spread 0.05 on the move).
//   Frag        — $300. Thrown, not fired: arcs under gravity, bounces once,
//                 detonates after a 2 s fuse. 80 damage at 1 m falling to
//                 10 at 6 m, only with line of sight past 1.5 m.
//
// SPREAD AND BLOOM. Spread grows with movement speed (spreadStill on
// standing still, spreadMove at full speed) and with sustained fire
// (bloom per shot, capped at bloomMax, decaying when not firing). The
// lesson is mechanical: stop to shoot straight, tap instead of holding.
// The crosshair gap in the HUD is driven by the same spread number, so
// what the player sees is what the gun does.
//
// FEEL. Each weapon has a view model built from boxes (receiver, barrel,
// stock, grip, magazine, scope) and a muzzle flash: a plane plus a point
// light that lives for 0.06 s. Firing kicks the model back (kick 0.055,
// decaying) and pitches the camera up; reloading dips the model down.
// The pistol is never sold, so the player always has a gun to fall back on.
// Weapons: five buys, one interface. The numbers are the game balance; main.js
// owns the ray and the damage, this module owns the feel.
//
//   P9 pistol   — free, 12/36, semi-auto, 26 body / 78 head. The fallback.
//   AR-7 rifle  — $2500, 30/90, auto, 34 body / 100 head. The workhorse.
//   VX-9 SMG    — $1500, 32/96, auto, 24 body / 72 head. Fast, close range.
//   L-88 sniper — $4000, 5/15, bolt, 90 body / 180 head. One shot, slow.
//   Frag grenade— $300, 1, thrown, 80 blast at 1 m falling to 10 at 6 m.
//
// Each weapon has a view model built from boxes (receiver, barrel, stock, grip),
// a muzzle flash, and a state machine: cooldown, reload, kick. Spread grows
// with movement speed and with sustained fire (bloom), and resets when the
// player stops. The sniper zooms (a narrower FOV while aiming) and cannot fire
// while moving fast. The grenade is not a gun: it leaves the hand, arcs under
// gravity, bounces once, and detonates after a fuse.
//
// A weapon is bought, not given: the buy menu hands this module a weapon id and
// it swaps the view model and the numbers. The pistol is never sold, so the
// player always has a gun.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

// WEAPONS — the table is the balance. Price, magazine, fire gap, reload
// time, body/head damage, spread (still and moving), bloom (per shot and
// cap), range and kick are all in one place, so a balance change is one
// number, not a hunt through the code. The sniper's zoom flag and the
// grenade's throwable flag are the only special cases; everything else is
// the same shape, which is why the buy menu, the HUD and the shooting
// code can all treat weapons uniformly. The pistol costs $0 and is never
// sold: the player always has a gun.
export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'P9 Pistol', price: 0, auto: false,
    magSize: 12, reserve: 36, fireGap: 0.16, reloadTime: 1.4,
    damageBody: 26, damageHead: 78, spreadStill: 0.004, spreadMove: 0.02,
    bloom: 0.002, bloomMax: 0.02, range: 60, kick: 0.006,
    // Pistol: free, always owned, 12 in the magazine. Three body shots to
    // kill a 100-health bot (26 x 3 = 78, so four at range), one headshot
    // plus a body shot (78 + 26). The pistol is the fallback, not a
    // peashooter: a player who loses their rifle still has a gun that can
    // win a duel, which is why the pistol round is a real round.
  },
  rifle: {
    id: 'rifle', name: 'AR-7 Rifle', price: 2500, auto: true,
    magSize: 30, reserve: 90, fireGap: 0.096, reloadTime: 1.9,
    damageBody: 34, damageHead: 100, spreadStill: 0.0022, spreadMove: 0.028,
    bloom: 0.0016, bloomMax: 0.018, range: 90, kick: 0.009,
    // Rifle: $2500, the all-rounder and the default buy. 30 in the
    // magazine, three body shots to kill (34 x 3 = 102), one headshot
    // (100). The 90 m range covers the whole map, the 0.096 s fire gap is
    // ~625 rounds per minute, and the bloom cap keeps a long burst from
    // becoming a lottery. If the player buys one gun, it is this one.
  },
  smg: {
    id: 'smg', name: 'VX-9 SMG', price: 1500, auto: true,
    magSize: 32, reserve: 96, fireGap: 0.07, reloadTime: 1.6,
    damageBody: 24, damageHead: 72, spreadStill: 0.006, spreadMove: 0.03,
    bloom: 0.0024, bloomMax: 0.026, range: 45, kick: 0.005,
    // SMG: $1500, the cheap rush gun. Faster fire (0.07 s gap) and a bigger
    // magazine (32), but 24 damage a body shot means five to kill, and the
    // 45 m range means it falls off down the lanes — it is a close-quarters
    // gun, bought to rush a site, not to hold a lane. The $1000 saved
    // against the rifle buys a grenade and change.
  },
  sniper: {
    id: 'sniper', name: 'L-88 Sniper', price: 4000, auto: false,
    magSize: 5, reserve: 15, fireGap: 1.1, reloadTime: 2.6,
    damageBody: 90, damageHead: 180, spreadStill: 0.0005, spreadMove: 0.05,
    bloom: 0.0, bloomMax: 0.0, range: 120, kick: 0.02, zoom: true,
    // Sniper: $4000, the whole economy in one gun. One body shot is 90 —
    // not a kill, so a missed follow-up matters — one headshot is 180, a
    // kill on anything. Five in the magazine, 1.1 s between shots, 2.6 s
    // to reload: every shot is a commitment. No bloom (the gun is precise
    // when still), but 0.05 spread on the move, so it must be fired from a
    // standstill. Zoom (right mouse) drops the FOV to 30.
  },
  grenade: {
    id: 'grenade', name: 'Frag Grenade', price: 300, auto: false,
    magSize: 1, reserve: 0, fireGap: 0.8, reloadTime: 0,
    damageBody: 0, damageHead: 0, spreadStill: 0, spreadMove: 0,
    bloom: 0, bloomMax: 0, range: 0, kick: 0.004, throwable: true,
    // Grenade: $300, one per purchase, thrown with 3 then click. It has no
    // damage of its own in this table (the blast is main.js's job: 80 at
    // 1 m falling to 10 at 6 m) — the entry exists so the grenade view
    // model can be equipped like a weapon and the buy menu can sell it
    // like a weapon, with the same shape as the guns.
  },
};

// createWeapon — build the weapon system on a camera: three shared
// materials (grip, body, dark), a muzzle flash plane and a point light
// parented to the camera, and one view model per weapon, built by
// buildModel. Only the equipped model is visible, so switching weapons is
// a visibility flip, not a rebuild. The state starts as the pistol with a
// full magazine, because the player always has a gun.
export function createWeapon(camera) {
  const grip = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 });
  const body = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.5, metalness: 0.35 });
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.surface), roughness: 0.6, metalness: 0.4 });

  const model = new THREE.Group();
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.24, 0.24),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.24, -0.18, -0.95);
  flash.visible = false;
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 5);
  flashLight.position.set(0.24, -0.16, -0.6);
  camera.add(flash, flashLight);
  camera.add(model);

  // View models, one per weapon. Each is a small group of boxes; the active one
  // is shown and the rest are hidden, so switching is a visibility flip.
  const models = {};
  // buildModel — one weapon's view model, from boxes, at the hip position
// (0.24, −0.20, −0.42) in camera space. A pistol is a slide and a frame;
// a rifle is a receiver, a barrel, a stock and a magazine; the SMG is the
// same shape smaller; the sniper adds a scope and a longer barrel; the
// grenade is a pin and a sphere. The models are deliberately chunky and
// low-poly: they are seen at arm's length, in motion, for a fraction of a
// second at a time, and the silhouette is what the player reads.
function buildModel(id) {
    const g = new THREE.Group();
    if (id === 'pistol') {
      const slide = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.2), body);
      const frame = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.07, 0.16), grip);
      frame.position.set(0, -0.05, 0.02);
      g.add(slide, frame);
    } else if (id === 'rifle') {
      const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.42), body);
      const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, 0.4), grip);
      barrel.position.set(0, 0.025, -0.38);
      const stock = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.08, 0.22), grip);
      stock.position.set(0, -0.02, 0.3);
      const mag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.14, 0.08), dark);
      mag.position.set(0, -0.1, -0.05);
      g.add(receiver, barrel, stock, mag);
    } else if (id === 'smg') {
      const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.09, 0.34), body);
      const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.26), grip);
      barrel.position.set(0, 0.02, -0.28);
      const stock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.16), grip);
      stock.position.set(0, -0.015, 0.24);
      const mag = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.16, 0.06), dark);
      mag.position.set(0, -0.11, 0.02);
      g.add(receiver, barrel, stock, mag);
    } else if (id === 'sniper') {
      const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.09, 0.5), body);
      const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, 0.55), grip);
      barrel.position.set(0, 0.02, -0.5);
      const scope = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.18), dark);
      scope.position.set(0, 0.08, -0.1);
      const stock = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.08, 0.24), grip);
      stock.position.set(0, -0.02, 0.32);
      g.add(receiver, barrel, scope, stock);
    } else if (id === 'grenade') {
      const pin = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.05), body);
      pin.position.set(0, 0.05, 0);
      const shell = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 10), dark);
      g.add(pin, shell);
    }
    g.position.set(0.24, -0.2, -0.42);
    g.visible = false;
    model.add(g);
    return g;
  }
  for (const id of Object.keys(WEAPONS)) models[id] = buildModel(id);

  const state = {
    id: 'pistol', mag: WEAPONS.pistol.magSize, reserve: WEAPONS.pistol.reserve,
    cooldown: 0, reloadLeft: 0, flash: 0, kick: 0, bloom: 0, zoomed: false,
    grenades: 0,
  };

  function current() {
    return WEAPONS[state.id];
  }

  // equip — switch to a weapon: show its model, hide the rest, load a full
// magazine and reserve from its stats, and clear cooldown, reload, flash,
// kick, bloom and zoom. Equipping is free and instant — the cost of a
// weapon is paid in the buy menu, never in the middle of a fight — and
// equipping an unknown id is ignored, so a bad buy id cannot break the
// player's gun.
function equip(id) {
    if (!WEAPONS[id]) return;
    for (const key of Object.keys(models)) models[key].visible = key === id;
    state.id = id;
    state.mag = WEAPONS[id].magSize;
    state.reserve = WEAPONS[id].reserve;
    state.cooldown = 0;
    state.reloadLeft = 0;
    state.flash = 0;
    state.kick = 0;
    state.bloom = 0;
    state.zoomed = false;
  }
  equip('pistol');

  // step — the weapon's per-frame state: cooldown and flash count down,
// kick decays back to zero (14/s, so the model settles quickly), bloom
// decays slowly (0.03/s, so sustained fire stays inaccurate for a while
// after the player stops), the active model sits at its kick offset and
// tilts with it, the flash plane spins while visible and the flash light
// burns only while the flash lives. Reloading dips the model down by up
// to 0.55 rad and, at zero, moves the reserve into the magazine — the
// reload completes exactly when the animation does.
function step(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    state.bloom = Math.max(0, state.bloom - dt * 0.03);
    const active = models[state.id];
    active.position.z = -0.42 + state.kick;
    active.rotation.x = state.kick * 2.2;
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 30;
    flashLight.intensity = state.flash > 0 ? 18 : 0;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      const w = current();
      active.rotation.x = -0.55 * Math.min(1, (w.reloadTime - state.reloadLeft) * 2);
      if (state.reloadLeft === 0) {
        const need = w.magSize - state.mag;
        const take = Math.min(need, state.reserve);
        state.mag += take;
        state.reserve -= take;
      }
    }
  }

  return {
    state,
    step,
    equip,
    current,
    // ready — can this weapon fire right now: a round in the magazine, the
// cooldown spent, and no reload in progress. main.js checks ready()
// before firing, so the fire rate, the magazine and the reload are all
// enforced in one place and the shooting code never fires a gun that is
// not ready.
ready() {
      return state.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    // pullTrigger — the feel of one shot: the fire gap becomes the cooldown
// (the fire rate), the flash lives 0.06 s, the kick jumps to 0.055, and
// bloom grows by the weapon's per-shot amount up to its cap. The damage
// and the ray are main.js's job; this module owns the timing and the feel,
// so the gunplay can be tuned without touching the shooting code.
pullTrigger() {
      const w = current();
      state.cooldown = w.fireGap;
      state.flash = 0.06;
      state.kick = 0.055;
      state.bloom = Math.min(w.bloomMax, state.bloom + w.bloom);
    },
    // takeRound — spend one round from the magazine, or refuse when empty.
// main.js calls this first in playerShoot, so an empty magazine clicks
// (audio.empty) instead of firing a phantom round. The magazine is the
// only ammunition the shooting code ever touches; the reserve is only
// moved by reload.
takeRound() {
      if (state.mag <= 0) return false;
      state.mag -= 1;
      return true;
    },
    // reload — start a reload: refused while already reloading, with a full
// magazine, or with an empty reserve. The reload time comes from the
// weapon's stats, so the rifle's 1.9 s and the sniper's 2.6 s are the
// same code path with different numbers — and the same vulnerability:
// reloading is the moment the player cannot shoot.
reload() {
      const w = current();
      if (state.reloadLeft > 0 || state.mag === w.magSize || state.reserve === 0) return;
      state.reloadLeft = w.reloadTime;
    },
    // spread — the current spread in radians: the still spread, plus the
// movement spread scaled by speed (full at 5.2 m/s, the walk speed), plus
// bloom. Standing still and firing single shots is the accurate gun; moving
// and holding the trigger is the inaccurate one. The HUD crosshair gap is
// driven by this same number.
spread(speed) {
      const w = current();
      const move = Math.min(1, speed / 5.2);
      return w.spreadStill + move * w.spreadMove + state.bloom;
    },
    // refill — a full magazine and a full reserve, all timers cleared. Used
// at round start (every round begins with a full gun) and on buy. Refill
// is free — ammunition is not part of the economy — because the economy
// is about which gun, not how many bullets it has.
refill() {
      const w = current();
      state.mag = w.magSize;
      state.reserve = w.reserve;
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
      state.bloom = 0;
      state.zoomed = false;
    },
    // Grenades are an inventory, not a weapon: addGrenade stocks one (bought),
// hasGrenade asks, useGrenade spends one (throwing). The grenade view
// model is a separate equip: the player switches to it with 3, throws
// with a click, and is switched back to the primary automatically. The
// grenade's own WEAPONS entry (magSize 1, fireGap 0.8) exists so the
// weapon table stays uniform — the throw itself is main.js's job.
addGrenade() {
      state.grenades += 1;
    },
    hasGrenade() {
      return state.grenades > 0;
    },
    // useGrenade / hasGrenade — spend and ask. useGrenade refuses when the
// inventory is empty, so a throw with no grenade is a no-op instead of a
// negative inventory. The inventory is the only grenade state: the view
// model is switched by main.js, the count lives here.
useGrenade() {
      if (state.grenades <= 0) return false;
      state.grenades -= 1;
      return true;
    },
    // setZoomed — the sniper's zoom state, set by main.js from the right
// mouse button. The FOV change itself lives in main.js (camera.fov 74
// ↔ 30); this only records the state, so the weapon knows whether it is
// zoomed and the view model can react. Only the sniper reads it — the
// other weapons ignore zoom entirely.
setZoomed(on) {
      state.zoomed = on;
    },
  };
}
