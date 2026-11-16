// HUD DESIGN — a push-only display with four zones.
//
// THE MODEL. The HUD never touches the simulation. main.js pushes numbers
// in (setHealth, setAmmo, setMoney, setTimer, setScore, setAlive, setBomb,
// setWeapon) and reads callbacks out (onPlay, onBuy). Every setter caches
// its last value and skips the DOM write when nothing changed, so the HUD
// costs nothing on frames where the numbers are steady — which is most
// frames, since health, money and score change in bursts, not per frame.
//
// THE ZONES. Four corners plus a centre column:
//   top centre — the topbar: round/bomb timer, score, alive counts, money,
//     bomb status. One monospace row, the match state at a glance.
//   bottom left — health: a big number, a bar, a label. The bar turns red
//     at 30 or below, so low health reads without reading the number.
//   bottom right — ammo: a huge magazine count, a small reserve, the weapon
//     name above it. The magazine turns amber at zero.
//   top right — the kill feed: at most 5 lines, newest first, each fading
//     after 6 s. Feeds are the only place names appear during play.
//   centre — the crosshair (four ticks, gap driven by weapon spread), the
//     hitmarker (a rotated square, red on kill, visible for 90 ms), the
//     damage flash (a red inset shadow for 180 ms), the plant/defuse bar
//     (58% down, with a label), and the banner (round results, 2.5–3.5 s).
//
// THE OVERLAYS. One overlay panel serves four modes: start (the title and
// the key list), paused, round end and match end. The copy lives in COPY so
// the modes cannot drift apart. The buy menu is a separate layer with
// pointer-events on, so it can be clicked while the game is not locked;
// everywhere else the HUD is pointer-events none and clicks fall through
// to the canvas. Focus goes to the play button when the overlay opens, so
// keyboard players can start with Enter, and a reduced-motion media query
// collapses the hitmarker, play-button and health-bar transitions.
// The DOM HUD: crosshair, hit marker, health, ammo, money, round timer, score,
// team counts, kill feed, bomb status, the buy menu and the overlay panels. It
// never touches the simulation; main.js pushes numbers in and reads callbacks
// out. Every setter caches its last value and skips the DOM write when nothing
// changed, so the HUD costs nothing on frames where the numbers are steady.
const COPY = {
  start: {
    title: 'Emberline Yard',
    copy: 'Plant the bomb at A or B, or eliminate the defenders. Click to play.',
    action: 'Click to play',
  },
  paused: {
    title: 'Emberline Yard',
    copy: 'Paused. Click to resume.',
    action: 'Click to resume',
  },
  roundEnd: {
    title: 'Round over',
    copy: '',
    action: 'Next round',
  },
  matchEnd: {
    title: 'Match over',
    copy: '',
    action: 'Play again',
  },
};

export function createHud() {
  const overlay = document.getElementById('overlay');
  const title = document.getElementById('overlay-title');
  const copy = document.getElementById('overlay-copy');
  const play = document.getElementById('play');
  const ammo = document.getElementById('ammo');
  const ammoMag = document.getElementById('ammo-mag');
  const ammoReserve = document.getElementById('ammo-reserve');
  const healthFill = document.getElementById('health-fill');
  const healthValue = document.getElementById('health-value');
  const moneyValue = document.getElementById('money-value');
  const timerValue = document.getElementById('timer-value');
  const scoreValue = document.getElementById('score-value');
  const aliveValue = document.getElementById('alive-value');
  const bombStatus = document.getElementById('bomb-status');
  const killfeed = document.getElementById('killfeed');
  const hitmarker = document.getElementById('hitmarker');
  const crosshair = document.getElementById('crosshair');
  const buyMenu = document.getElementById('buy-menu');
  const buyMoney = document.getElementById('buy-money');
  const plantBar = document.getElementById('plant-bar');
  const plantFill = document.getElementById('plant-fill');
  const plantLabel = document.getElementById('plant-label');
  const banner = document.getElementById('banner');
  const damage = document.getElementById('damage');
  let hitTimer = 0;
  let bannerTimer = 0;
  let lastMag = -1;
  let lastReserve = -1;
  let lastHealth = -1;
  let lastMoney = -1;
  let lastTimer = '';
  let lastScore = '';
  let lastAlive = '';
  let lastBomb = '';
  let lastWeapon = '';

  return {
    setAmmo(mag, reserve) {
      if (mag === lastMag && reserve === lastReserve) return;
      lastMag = mag;
      lastReserve = reserve;
      ammoMag.textContent = String(mag);
      ammoReserve.textContent = `/ ${reserve}`;
      ammo.classList.toggle('empty', mag === 0);
    },
    setHealth(hp) {
      const v = Math.max(0, Math.round(hp));
      if (v === lastHealth) return;
      lastHealth = v;
      healthValue.textContent = String(v);
      healthFill.style.width = `${v}%`;
      healthFill.classList.toggle('low', v <= 30);
    },
    setMoney(value) {
      if (value === lastMoney) return;
      lastMoney = value;
      moneyValue.textContent = `$${value}`;
      buyMoney.textContent = `$${value}`;
    },
    setTimer(seconds, label) {
      const s = Math.max(0, Math.ceil(seconds));
      const text = `${label} ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      if (text === lastTimer) return;
      lastTimer = text;
      timerValue.textContent = text;
      timerValue.classList.toggle('urgent', s <= 10 && label === 'Round');
    },
    setScore(a, b) {
      const text = `${a} — ${b}`;
      if (text === lastScore) return;
      lastScore = text;
      scoreValue.textContent = text;
    },
    setAlive(a, b) {
      const text = `ATK ${a} · DEF ${b}`;
      if (text === lastAlive) return;
      lastAlive = text;
      aliveValue.textContent = text;
    },
    setBomb(text) {
      if (text === lastBomb) return;
      lastBomb = text;
      bombStatus.textContent = text;
      bombStatus.hidden = !text;
    },
    setWeapon(name) {
      if (name === lastWeapon) return;
      lastWeapon = name;
      document.getElementById('weapon-name').textContent = name;
    },
    hitMarker(killed, holdMs = 90) {
      hitmarker.classList.add('on');
      hitmarker.classList.toggle('kill', killed);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => {
        hitmarker.classList.remove('on', 'kill');
      }, holdMs);
    },
    setCrosshairGap(gap) {
      crosshair.style.setProperty('--gap', `${gap.toFixed(1)}px`);
    },
    damageFlash() {
      damage.classList.add('on');
      setTimeout(() => damage.classList.remove('on'), 180);
    },
    feed(text) {
      const line = document.createElement('div');
      line.className = 'feed-line';
      line.textContent = text;
      killfeed.prepend(line);
      while (killfeed.children.length > 5) killfeed.removeChild(killfeed.lastChild);
      setTimeout(() => line.remove(), 6000);
    },
    showBanner(text, ms = 2500) {
      banner.textContent = text;
      banner.hidden = false;
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => { banner.hidden = true; }, ms);
    },
    showPlant(label, progress) {
      plantBar.hidden = false;
      plantLabel.textContent = label;
      plantFill.style.width = `${Math.round(progress * 100)}%`;
    },
    hidePlant() {
      plantBar.hidden = true;
    },
    showBuy(show) {
      buyMenu.hidden = !show;
    },
    showOverlay(mode, detail) {
      const text = COPY[mode];
      title.textContent = text.title;
      copy.textContent = detail || text.copy;
      play.textContent = text.action;
      overlay.hidden = false;
      play.focus();
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    onPlay(handler) {
      play.addEventListener('click', handler);
    },
    onBuy(handler) {
      buyMenu.addEventListener('click', (event) => {
        const button = event.target.closest('[data-buy]');
        if (!button) return;
        handler(button.dataset.buy);
      });
    },
  };
}
