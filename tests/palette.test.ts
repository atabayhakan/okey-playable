import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Read as a file: through the bundler a stylesheet comes back empty in a test.
const css = readFileSync(new URL('../src/ui/styles.css', import.meta.url), 'utf8');

/**
 * The tile colours, read from the stylesheet, and how far apart they look to someone with protanopia,
 * deuteranopia or tritanopia (Machado, Oliveira and Fernandes 2009, full severity). The difference is CIE76 in Lab:
 * about 2 is the least a person with normal vision can tell, 20 and more is a colour that cannot be mistaken.
 */

type Rgb = [number, number, number];
const NAMES = ['red', 'yellow', 'blue', 'black'] as const;
type Name = (typeof NAMES)[number];

const hex = (s: string): Rgb => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16)) as Rgb;
const lin = (v: number) => {
  v /= 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const delin = (v: number) => {
  v = Math.min(1, Math.max(0, v));
  return 255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
};

const MACHADO = {
  protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  tritanopia: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
} as const;
type Vision = 'normal' | keyof typeof MACHADO;
const VISIONS: Vision[] = ['normal', 'protanopia', 'deuteranopia', 'tritanopia'];

function see(rgb: Rgb, vision: Vision): Rgb {
  if (vision === 'normal') return rgb;
  const l = rgb.map(lin);
  return MACHADO[vision].map((row) => delin(row[0] * l[0] + row[1] * l[1] + row[2] * l[2])) as Rgb;
}

function lab(rgb: Rgb): [number, number, number] {
  const [r, g, b] = rgb.map(lin);
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047);
  const y = f(0.2126729 * r + 0.7151522 * g + 0.072175 * b);
  const z = f((0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
const distance = (a: Rgb, b: Rgb) => Math.hypot(...lab(a).map((v, i) => v - lab(b)[i]));

const luminance = (rgb: Rgb) => {
  const [r, g, b] = rgb.map(lin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
/** WCAG contrast of a colour on the darkest shade of a tile's face (the face is a gradient). */
const onTileFace = (rgb: Rgb) => (luminance(hex('#efe5d0')) + 0.05) / (luminance(rgb) + 0.05);

/** The four colours a block of the stylesheet sets: `:root` for the standard set, the palette attribute for the other. */
function palette(selector: string): Record<Name, Rgb> {
  const start = css.indexOf(selector);
  expect(start, `${selector} is in the stylesheet`).toBeGreaterThanOrEqual(0);
  const block = css.slice(start, css.indexOf('}', start));
  return Object.fromEntries(NAMES.map((name) => {
    const found = block.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
    expect(found, `--${name} in ${selector}`).not.toBeNull();
    return [name, hex(found![1])];
  })) as Record<Name, Rgb>;
}

/** The two colours that look most alike to anyone, and how far apart they look. */
function closest(colours: Record<Name, Rgb>): { distance: number; pair: string } {
  let worst = { distance: Infinity, pair: '' };
  for (const vision of VISIONS) {
    for (let i = 0; i < NAMES.length; i++) {
      for (let j = i + 1; j < NAMES.length; j++) {
        const d = distance(see(colours[NAMES[i]], vision), see(colours[NAMES[j]], vision));
        if (d < worst.distance) worst = { distance: d, pair: `${NAMES[i]} and ${NAMES[j]} with ${vision}` };
      }
    }
  }
  return worst;
}

const standard = palette(':root');
const colourBlind = palette("#app[data-palette='colorblind']");

describe('the tile colours', () => {
  it('are read from the stylesheet: four colours in each set, and the two sets differ', () => {
    for (const name of NAMES) expect(colourBlind[name]).not.toEqual(standard[name]);
  });

  it('can be read on a tile: 4.5:1 or more against the face, in both sets', () => {
    for (const [label, colours] of [['standard', standard], ['colour-blind', colourBlind]] as const) {
      for (const name of NAMES) expect(onTileFace(colours[name]), `${label} ${name}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('are told apart by someone with any of the three kinds of colour blindness in the colour-blind set', () => {
    const worst = closest(colourBlind);
    expect(worst.distance, worst.pair).toBeGreaterThanOrEqual(20);
  });

  it('are better told apart in the colour-blind set than in the standard one, by a good margin', () => {
    // Deuteranopes see the standard red and yellow about 7 apart: nearly the same colour. The shapes of the
    // marks carry the standard set; the colour-blind set does not have to rely on them alone.
    expect(closest(standard).distance).toBeLessThan(10);
    expect(closest(colourBlind).distance).toBeGreaterThan(closest(standard).distance * 2);
  });

  it('keep each colour recognisably its name: the red is reddish, the blue bluish, the yellow golden, the black dark', () => {
    const [r, y, b, k] = NAMES.map((n) => colourBlind[n]);
    expect(r[0]).toBeGreaterThan(r[1] * 3);
    expect(r[0]).toBeGreaterThan(r[2] * 3);
    expect(b[2]).toBeGreaterThan(b[0] * 1.5);
    expect(y[0]).toBeGreaterThan(y[2] * 4);
    expect(y[1]).toBeGreaterThan(y[2] * 4);
    expect(luminance(k)).toBeLessThan(0.01);
  });
});
