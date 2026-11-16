// COLOUR THEORY — six values, one accent.
//
// THE SIX. canvas #1a1512 is the dark ground everything sits on; surface
// #2a2320 is the panel and wall tone; hairline #3d332c is the border and
// crate tone; ink #efe8da is the text and the bright metal; muted #a89a86
// is the secondary text; accent #f0a830 is the amber that marks everything
// that matters — the bomb pads, the muzzle flash, the money, the buy
// prices, the hitmarker, the plant bar. One accent means the player's eye
// learns a single rule: amber is important. The same six names are the CSS
// custom properties in index.html, so the page and the game cannot drift.
//
// THE WORLD'S TWO EXCEPTIONS. The floor is a warm sand #b59a6a and the
// containers are rust #8a4a2a — the only colours outside the six, and both
// are there to make the yard read as a yard: sand underfoot, rust on the
// steel. Everything else — walls, crates, bots, view models — is built
// from the six. Lighting does the rest: a warm key and a cool fill make
// the same six shades read as a dozen.
// The look plan, in one place. Six values and one accent hue; the lighting makes every
// shade the game needs, so no other colour appears in the code. The same six names are
// the CSS custom properties in index.html. Emberline Yard is a warm late-afternoon
// industrial yard: dark steel walls, sand floor, rust containers, amber accent.
export const PALETTE = {
  canvas: '#1a1512',
  surface: '#2a2320',
  hairline: '#3d332c',
  ink: '#efe8da',
  muted: '#a89a86',
  accent: '#f0a830',
};

// shade — the palette accessor: one function, one name in, one colour out.
// The game never hard-codes a colour; it asks the palette, so the whole
// look can be retuned by editing six values in one place.
export function shade(name) {
  return PALETTE[name];
}
