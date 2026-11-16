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

export function shade(name) {
  return PALETTE[name];
}
