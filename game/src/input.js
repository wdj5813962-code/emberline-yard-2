// INPUT DESIGN — edge-triggered keys and pointer lock.
//
// POINTER LOCK. The game asks the canvas for pointer lock; while it holds
// it, mouse movement accumulates into lookX/lookY (read and zeroed once per
// frame by takeLook) instead of moving a cursor. Losing the lock clears the
// keys and the firing state and reports through onLockChange, so the game
// can pause itself — the player never comes back to a gun that is still
// firing or a movement key stuck down. Right-click is aim (for the sniper
// zoom) and the context menu is suppressed, because a context menu mid-fight
// would also drop the lock.
//
// EDGE-TRIGGERED KEYS. keys is the held set; pressedKeys is the set of keys
// that went down since the last frame, and pressed(code) answers once and
// removes the key. That is what makes a tap of B open the buy menu once
// instead of every frame, a tap of G throw one grenade, and a tap of 1/2/3
// switch weapons once. Held keys (WASD, Space, E, R) are read from the held
// set every step instead, because holding them is the input. Space also
// calls preventDefault so the page never scrolls, and blur clears the held
// set so alt-tabbing cannot leave a key stuck.
//
// THE KEY MAP. WASD move, mouse look, click fire, R reload, Ctrl/C crouch,
// Space jump, 1/2/3 weapon slots, G grenade, E plant/defuse (hold), B buy
// menu, Shift walk (slow, accurate — read by main.js through the held set,
// not here). The module knows nothing about the game: it only reports keys
// and lock state, so it can be tested without the rest of the game.
// Keyboard and mouse, and the pointer lock that turns the mouse into look. Plain browser
// APIs only: the game asks the canvas for pointer lock and reads movementX/Y while it holds it.
//
// Keys the game reads: WASD move, mouse look, click fire, R reload, Ctrl/C crouch,
// Space jump, 1/2/3/4 weapon slots, G throw grenade, E plant/defuse (hold),
// B buy menu, Shift walk (slow, accurate). Edge-triggered keys (pressed this
// frame, not held) are reported through pressed(), so a tap of B opens the menu
// once instead of every frame.
// createInput — wire the listeners once and return the handle. Keydown
// and keyup maintain the held set and the pressed set; blur clears the
// held set; mousemove accumulates look while locked; mousedown/up set
// firing (left) and aiming (right); contextmenu is suppressed; and
// pointerlockchange updates the locked flag, clears the keys on unlock,
// and reports through onLockChange. The canvas is only used for
// requestPointerLock — the listeners are on window and document, so a
// key pressed while the HUD has focus still reaches the game.
// THE BINDINGS — the whole control scheme in one place. WASD moves, Space
// jumps, Ctrl or C crouches, Shift walks (a slow, quiet walk for holding
// an angle), mouse looks, left click fires, right click aims (and zooms
// the sniper), R reloads, 1/2/3 switch weapons, G throws the grenade,
// E plants and defuses (held), B opens the buy menu in the buy phase,
// Esc pauses (by releasing the pointer). The bindings are read by the
// input module, and the overlay lists them, so the two can never drift
// apart.
export function createInput(canvas, onLockChange) {
  const keys = new Set();
  const pressedKeys = new Set();
  const state = { keys, locked: false, firing: false, lookX: 0, lookY: 0 };

  function setKey(event, down) {
    if (down) {
      if (!keys.has(event.code)) pressedKeys.add(event.code);
      keys.add(event.code);
    } else {
      keys.delete(event.code);
    }
    if (event.code === 'Space') event.preventDefault();
  }

  window.addEventListener('keydown', (event) => setKey(event, true));
  window.addEventListener('keyup', (event) => setKey(event, false));
  window.addEventListener('blur', () => keys.clear());
  window.addEventListener('mousemove', (event) => {
    if (!state.locked) return;
    state.lookX += event.movementX;
    state.lookY += event.movementY;
  });
  window.addEventListener('mousedown', (event) => {
    if (state.locked && event.button === 0) state.firing = true;
    if (state.locked && event.button === 2) state.aiming = true;
  });
  window.addEventListener('mouseup', (event) => {
    if (event.button === 0) state.firing = false;
    if (event.button === 2) state.aiming = false;
  });
  window.addEventListener('contextmenu', (event) => event.preventDefault());
  document.addEventListener('pointerlockchange', () => {
    state.locked = document.pointerLockElement === canvas;
    if (!state.locked) {
      keys.clear();
      state.firing = false;
      state.aiming = false;
    }
    onLockChange(state.locked);
  });

  return {
    state,
    // requestLock / clearPressed — the two small verbs: ask the canvas for
// pointer lock (the click that starts play), and clear the edge-triggered
// set (used when the round resets, so a key pressed in the last frame of
// one round cannot fire an action in the first frame of the next).
requestLock() {
      canvas.requestPointerLock();
    },
    // takeLook — the mouse movement since the last frame, as a pair, zeroed
// on read. Accumulating into lookX/lookY and draining once per frame is
// what keeps the look smooth at any frame rate: ten small mousemove
// events become one look delta, and a frame that runs long still turns
// the same total amount.
takeLook() {
      const x = state.lookX;
      const y = state.lookY;
      state.lookX = 0;
      state.lookY = 0;
      return { x, y };
    },
    // Edge-triggered: true once for the frame the key went down, then false.
    // pressed — the edge trigger: true once for the frame the key went down,
// then false until the next press. Held keys are read from the set every
// step; tapped keys (buy, grenade, reload, weapon slots) are read through
// here, so a tap is one action and a hold is not a hundred. The key is
// removed when read, so two readers cannot both consume one press.
pressed(code) {
      if (pressedKeys.has(code)) {
        pressedKeys.delete(code);
        return true;
      }
      return false;
    },
    clearPressed() {
      pressedKeys.clear();
    },
  };
}
