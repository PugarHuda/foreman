import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

/**
 * The palette is checked, not eyeballed. --dim once sat at 2.8:1 while
 * carrying machine names, status badges and the ISO zone labels, so the
 * smallest text on a shop-floor panel was also the faintest.
 */
const css = fs.readFileSync("app/globals.css", "utf8");

/**
 * Each `:root` block is its own palette. There are two: the panel's dark one,
 * and the light one the print stylesheet swaps in so a deck printed to PDF is
 * black on white rather than a page of toner.
 *
 * Reading every `--x: #hex` in the file into one object silently let the
 * second palette overwrite the first, so the suite spent a while checking the
 * print colours against themselves and calling it the panel. Parse the blocks
 * apart, and check both — a printed deck has to be readable too.
 */
function palettes(): Record<string, string>[] {
  const blocks = [...css.matchAll(/:root\s*\{([^}]*)\}/g)].map((m) =>
    Object.fromEntries(
      [...m[1].matchAll(/--([a-z-]+):\s*(#[0-9a-fA-F]{3,8})\b/g)].map((v) => [
        v[1],
        // #abc is legal CSS and was being skipped, which is how a colour
        // leaves the contrast check without anyone deleting it.
        v[2].length === 4
          ? `#${v[2][1]}${v[2][1]}${v[2][2]}${v[2][2]}${v[2][3]}${v[2][3]}`
          : v[2].slice(0, 7),
      ]),
    ),
  );
  if (blocks.length === 0) throw new Error("no :root palette found in globals.css");
  const [base, ...overrides] = blocks;
  // An override block only restates what it changes, so merge onto the base.
  return [base, ...overrides.map((o) => ({ ...base, ...o }))];
}

const ALL = palettes();
const vars = ALL[0];

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Every surface text can land on. panel-hi is the lightest, so the hardest. */
const SURFACES = ["void", "panel", "panel-hi"] as const;

describe("palette contrast", () => {
  it("meets WCAG AA for body text on every surface", () => {
    for (const text of ["ink", "muted", "dim"] as const) {
      for (const surface of SURFACES) {
        const ratio = contrast(vars[text], vars[surface]);
        assert.ok(
          ratio >= 4.5,
          `--${text} on --${surface} is ${ratio.toFixed(2)}:1, needs 4.5:1`,
        );
      }
    }
  });

  /* A deck printed to PDF is how this pitch reaches anyone who was not sent
     the URL, and paper has no dark mode. */
  it("meets it on paper too, for every palette in the file", () => {
    for (const [i, palette] of ALL.entries()) {
      for (const text of ["ink", "muted", "dim"] as const) {
        for (const surface of SURFACES) {
          const ratio = contrast(palette[text], palette[surface]);
          assert.ok(
            ratio >= 4.5,
            `palette ${i}: --${text} on --${surface} is ${ratio.toFixed(2)}:1, needs 4.5:1`,
          );
        }
      }
    }
  });

  it("keeps the severity bands distinguishable against the panel", () => {
    for (const zone of ["zone-a", "zone-b", "zone-c", "zone-d"] as const) {
      const ratio = contrast(vars[zone], vars.panel);
      assert.ok(ratio >= 3, `--${zone} is ${ratio.toFixed(2)}:1, needs 3:1 for large text`);
    }
  });

  it("keeps three visible tiers rather than three names for one grey", () => {
    // If dim and muted collapse together the hierarchy is decorative.
    const gap = relativeLuminance(vars.muted) / relativeLuminance(vars.dim);
    assert.ok(gap >= 1.15, `--muted is only ${gap.toFixed(2)}x --dim; the tiers have merged`);
    assert.ok(relativeLuminance(vars.ink) > relativeLuminance(vars.muted));
  });

  it("keeps the smallest text large enough to read across a room", () => {
    const sizes = [...css.matchAll(/font-size:\s*(\d+)px/g)].map((m) => Number(m[1]));
    const smallest = Math.min(...sizes);
    assert.ok(smallest >= 11, `smallest font is ${smallest}px; badges and labels vanish on a projector`);
  });
});
