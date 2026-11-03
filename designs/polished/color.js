// Colour helpers. Every derived colour in the launcher (focus ring, glow, tinted
// icons, card tints) is computed here and handed to the CSS as a ready-made
// value. Newer CSS such as color-mix() is avoided on purpose: an older TV
// browser drops a whole rule it can't parse, and animating a colour variable
// repaints the entire page on every frame.

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r, g, b) {
  return `#${[r, g, b].map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('')}`;
}

/** "#rgb", "#rrggbb", "rgb(...)" or "rgba(...)" as "#rrggbb"; null if it isn't a colour. */
function toHex(c) {
  if (typeof c !== 'string') return null;
  const s = c.trim().toLowerCase();
  let m = s.match(/^#([0-9a-f]{3})$/);
  if (m) return `#${m[1].split('').map((ch) => ch + ch).join('')}`;
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  m = s.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/);
  return m ? rgbToHex(+m[1], +m[2], +m[3]) : null;
}

/** Share t (0..1) of colour a, the rest colour b. */
function mixHex(a, b, t) {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return rgbToHex(A[0] * t + B[0] * (1 - t), A[1] * t + B[1] * (1 - t), A[2] * t + B[2] * (1 - t));
}

function withAlpha(hex, a) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

/** h 0..360, s and l 0..1. */
function hslToHex(h, s, l) {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return rgbToHex(f(0) * 255, f(8) * 255, f(4) * 255);
}
