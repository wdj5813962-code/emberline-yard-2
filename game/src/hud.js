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
// COPY — the overlay's words in one place. Start tells the objective in
// one sentence (plant at A or B, or eliminate); paused is two words;
// roundEnd and matchEnd take their copy from the detail argument (the
// round result, the final score), because those lines are written by the
// match, not by the UI. The action labels are verbs, so the button reads
// as an instruction, not a title.
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
  const damageDir = document.getElementById('damage-dir');
  let hitTimer = 0;
  let bannerTimer = 0;
  let damageDirTimer = 0;
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
    // setAmmo — the magazine and reserve, written only when they change, with
// the ammo block turning amber at zero. The magazine is the big number
// because it is the number the player reads mid-fight; the reserve is
// small because it is read between fights.
setAmmo(mag, reserve) {
      if (mag === lastMag && reserve === lastReserve) return;
      lastMag = mag;
      lastReserve = reserve;
      ammoMag.textContent = String(mag);
      ammoReserve.textContent = `/ ${reserve}`;
      ammo.classList.toggle('empty', mag === 0);
    },
    // setHealth — health, rounded and clamped at zero, driving the number and
// the bar width together (one write, one paint). The bar turns red at 30
// or below, so low health reads as a colour before it reads as a number.
setHealth(hp) {
      const v = Math.max(0, Math.round(hp));
      if (v === lastHealth) return;
      lastHealth = v;
      healthValue.textContent = String(v);
      healthFill.style.width = `${v}%`;
      healthFill.classList.toggle('low', v <= 30);
    },
    // setMoney — money in two places at once: the topbar and the buy menu.
// One setter keeps them in sync, so the menu can never show a different
// balance from the game. Money is the only number the player spends, so
// it is the only number shown twice.
setMoney(value) {
      if (value === lastMoney) return;
      lastMoney = value;
      moneyValue.textContent = `$${value}`;
      buyMoney.textContent = `$${value}`;
    },
    // setTimer — the round or bomb timer as M:SS with a label ("Buy", "Round",
// "Bomb"). The timer turns red under 10 s of a round — urgency is a
// colour, not a second number to read. Ceiled, so the display never shows
// 0:00 while a fraction of a second remains.
setTimer(seconds, label) {
      const s = Math.max(0, Math.ceil(seconds));
      const text = `${label} ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      if (text === lastTimer) return;
      lastTimer = text;
      timerValue.textContent = text;
      timerValue.classList.toggle('urgent', s <= 10 && label === 'Round');
    },
    // setScore — the match score as "A — B", attackers first. The em dash is
// the separator so the score reads as a score, not a subtraction.
setScore(a, b) {
      const text = `${a} — ${b}`;
      if (text === lastScore) return;
      lastScore = text;
      scoreValue.textContent = text;
    },
    // setAlive — the living counts as "ATK 4 · DEF 4". The player counts for
// the attackers (main.js adds 1 when alive), so the counts always sum to
// the living actors on the field. The alive counts are the elimination
// check made visible: when one side reads 0, the round is over.
setAlive(a, b) {
      const text = `ATK ${a} · DEF ${b}`;
      if (text === lastAlive) return;
      lastAlive = text;
      aliveValue.textContent = text;
    },
    // setBomb — the bomb status line ("BOMB PLANTED — Site A"), shown only
// while a bomb is planted. Hidden otherwise, so an empty status never
// occupies the topbar. The text is red and bold: a planted bomb is the
// most urgent information in the game.
setBomb(text) {
      if (text === lastBomb) return;
      lastBomb = text;
      bombStatus.textContent = text;
      bombStatus.hidden = !text;
    },
    // setWeapon — the weapon name above the ammo ("P9 Pistol", "AR-7 Rifle").
// Uppercase, letter-spaced, muted: it is a label, not a readout, and it
// changes only on switch or buy, so it is almost always cached away.
setWeapon(name) {
      if (name === lastWeapon) return;
      lastWeapon = name;
      document.getElementById('weapon-name').textContent = name;
    },
    // hitMarker — the hit confirmation: a rotated square at the crosshair for
// 90 ms, red when the hit was a kill. 90 ms is a flash, not a state: the
// player feels the hit without reading it. A new hit replaces the old
// marker and restarts its timer, so rapid hits do not stack markers.
hitMarker(killed, holdMs = 90) {
      hitmarker.classList.add('on');
      hitmarker.classList.toggle('kill', killed);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => {
        hitmarker.classList.remove('on', 'kill');
      }, holdMs);
    },
    // setCrosshairGap — the crosshair gap in pixels, driven by weapon spread:
// 2 px standing still, wider on the move and while firing. The gap is a
// CSS variable, so the crosshair breathes with the gun without a DOM
// rebuild — one style property per frame at most, usually none.
setCrosshairGap(gap) {
      crosshair.style.setProperty('--gap', `${gap.toFixed(1)}px`);
    },
    // damageFlash — a red inset shadow over the whole viewport for 180 ms.
// Full-screen because damage has no position on screen until the
// direction indicator (see showDamageDirection) — the flash says "you are
// hurt", the indicator says "from where". The two together are the damage
// model: a flash for the fact, a marker for the direction.
damageFlash() {
      damage.classList.add('on');
      setTimeout(() => damage.classList.remove('on'), 180);
    },
    // showDamageDirection — a red triangle on a ring around the crosshair,
    // rotated to the side the damage came from: angle 0 is straight ahead
    // (12 o'clock), π is straight behind. The wrapper rotates; the
    // triangle rides the ring. Visible for 600 ms, then it fades; a new
    // hit replaces it and restarts the timer, so the marker always shows
    // the latest threat, not a queue of old ones.
    showDamageDirection(angle) {
      damageDir.style.transform = `rotate(${angle}rad)`;
      damageDir.classList.add('on');
      clearTimeout(damageDirTimer);
      damageDirTimer = setTimeout(() => damageDir.classList.remove('on'), 600);
    },
    // feed — one kill-feed line, newest first, at most 5 on screen, each
// fading after 6 s. The feed is the match's memory: who killed whom, and
// whether the player did it. Lines are prepended (not appended) so the
// newest kill is always at the top, where the eye already is.
feed(text) {
      const line = document.createElement('div');
      line.className = 'feed-line';
      line.textContent = text;
      killfeed.prepend(line);
      while (killfeed.children.length > 5) killfeed.removeChild(killfeed.lastChild);
      setTimeout(() => line.remove(), 6000);
    },
    // showBanner — a centre-top announcement (round won/lost, bomb planted,
// player down) for 2.5 s by default. A new banner replaces the old one
// and restarts its timer, so two events in quick succession show the
// second, not a queue of stale news.
showBanner(text, ms = 2500) {
      banner.textContent = text;
      banner.hidden = false;
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => { banner.hidden = true; }, ms);
    },
    // showPlant / hidePlant — the plant/defuse progress bar: a label ("Planting
// at Site A…", "Moss is defusing…") and a fill that tracks the channel
// from 0 to 100%. One bar serves both channels because a plant and a
// defuse never run at once — the bomb is either being planted or being
// defused, never both. Hiding the bar is a single hidden flag, so a
// cancelled channel leaves no stale progress on screen.
showPlant(label, progress) {
      plantBar.hidden = false;
      plantLabel.textContent = label;
      plantFill.style.width = `${Math.round(progress * 100)}%`;
    },
    hidePlant() {
      plantBar.hidden = true;
    },
    // showBuy — the buy menu, shown in the buy phase and hidden when the round
// goes live. The menu is a layer over the game, not a pause: the buy timer
// keeps running while it is open, so browsing the shop costs time — the
// buy decision is part of the round, not a break from it.
showBuy(show) {
      buyMenu.hidden = !show;
    },
    // showOverlay / hideOverlay — the modal panel: start (title, copy, the
// key list), paused, round end, match end. The copy lives in COPY, so
// the four modes cannot drift apart, and a detail string overrides the
// default copy (the final score, the round result). Showing the overlay
// focuses the play button, so keyboard players can start with Enter.
// Hiding it is a single hidden flag.
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
    // onPlay / onBuy — the HUD's two callbacks out. onPlay fires the play
// button (start, resume, next round, play again — main.js decides which
// by the match state). onBuy delegates clicks from the buy grid: the
// closest [data-buy] button names the purchase, so adding a shop item is
// adding a button, not a handler.
onPlay(handler) {
      play.addEventListener('click', handler);
    },
    // onBuy — the buy handler: one delegated click listener on the menu. The
// closest [data-buy] button names the purchase, so the four shop items
// share one handler and adding a fifth is adding a button. Clicks that
// miss a button (the panel background, the hint text) are ignored.
onBuy(handler) {
      buyMenu.addEventListener('click', (event) => {
        const button = event.target.closest('[data-buy]');
        if (!button) return;
        handler(button.dataset.buy);
      });
    },
  };
}
