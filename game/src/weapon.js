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

export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'P9 Pistol', price: 0, auto: false,
    magSize: 12, reserve: 36, fireGap: 0.16, reloadTime: 1.4,
    damageBody: 26, damageHead: 78, spreadStill: 0.004, spreadMove: 0.02,
    bloom: 0.002, bloomMax: 0.02, range: 60, kick: 0.006,
  },
  rifle: {
    id: 'rifle', name: 'AR-7 Rifle', price: 2500, auto: true,
    magSize: 30, reserve: 90, fireGap: 0.096, reloadTime: 1.9,
    damageBody: 34, damageHead: 100, spreadStill: 0.0022, spreadMove: 0.028,
    bloom: 0.0016, bloomMax: 0.018, range: 90, kick: 0.009,
  },
  smg: {
    id: 'smg', name: 'VX-9 SMG', price: 1500, auto: true,
    magSize: 32, reserve: 96, fireGap: 0.07, reloadTime: 1.6,
    damageBody: 24, damageHead: 72, spreadStill: 0.006, spreadMove: 0.03,
    bloom: 0.0024, bloomMax: 0.026, range: 45, kick: 0.005,
  },
  sniper: {
    id: 'sniper', name: 'L-88 Sniper', price: 4000, auto: false,
    magSize: 5, reserve: 15, fireGap: 1.1, reloadTime: 2.6,
    damageBody: 90, damageHead: 180, spreadStill: 0.0005, spreadMove: 0.05,
    bloom: 0.0, bloomMax: 0.0, range: 120, kick: 0.02, zoom: true,
  },
  grenade: {
    id: 'grenade', name: 'Frag Grenade', price: 300, auto: false,
    magSize: 1, reserve: 0, fireGap: 0.8, reloadTime: 0,
    damageBody: 0, damageHead: 0, spreadStill: 0, spreadMove: 0,
    bloom: 0, bloomMax: 0, range: 0, kick: 0.004, throwable: true,
  },
};

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
    ready() {
      return state.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    pullTrigger() {
      const w = current();
      state.cooldown = w.fireGap;
      state.flash = 0.06;
      state.kick = 0.055;
      state.bloom = Math.min(w.bloomMax, state.bloom + w.bloom);
    },
    takeRound() {
      if (state.mag <= 0) return false;
      state.mag -= 1;
      return true;
    },
    reload() {
      const w = current();
      if (state.reloadLeft > 0 || state.mag === w.magSize || state.reserve === 0) return;
      state.reloadLeft = w.reloadTime;
    },
    spread(speed) {
      const w = current();
      const move = Math.min(1, speed / 5.2);
      return w.spreadStill + move * w.spreadMove + state.bloom;
    },
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
    addGrenade() {
      state.grenades += 1;
    },
    hasGrenade() {
      return state.grenades > 0;
    },
    useGrenade() {
      if (state.grenades <= 0) return false;
      state.grenades -= 1;
      return true;
    },
    setZoomed(on) {
      state.zoomed = on;
    },
  };
}
