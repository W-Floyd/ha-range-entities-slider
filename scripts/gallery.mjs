#!/usr/bin/env node
/**
 * Emits the screenshot gallery appended to a release's notes.
 *
 *   node scripts/gallery.mjs <tag> [screenshot_dir]
 *
 * Release assets are flat and their URLs are deterministic
 * (releases/download/<tag>/<file>), so the markdown can be written before the
 * files are uploaded. Theme captures are prefixed `theme-` to keep them from
 * colliding with the top-level ones once flattened.
 *
 * Unlike workflow artifacts, release assets do not expire, so these links keep
 * working for as long as the release exists.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";

const [tag, dir = "tests/screenshots"] = process.argv.slice(2);
if (!tag) {
  console.error("usage: gallery.mjs <tag> [screenshot_dir]");
  process.exit(1);
}

const repo = process.env.GITHUB_REPOSITORY ?? "W-Floyd/ha-range-entities-slider";
const url = (file) =>
  `https://github.com/${repo}/releases/download/${tag}/${file}`;

const png = (d) =>
  existsSync(d) ? readdirSync(d).filter((f) => f.endsWith(".png")).sort() : [];

const base = png(dir);

/**
 * The theme captures the sweep recorded, taken from its manifest rather than
 * from whatever is in the directory: the same run also writes comparison and
 * diagnostic crops — a stock row held mid-drag, magnified handles, the card with
 * its styling detached — which exist to be diffed against, not shown to anyone.
 */
const manifestPath = `${dir}/themes/manifest.json`;
const manifest = existsSync(manifestPath)
  ? JSON.parse(readFileSync(manifestPath, "utf8"))
  : [];
const themes = manifest.length
  ? manifest.map((entry) => entry.file)
  : png(`${dir}/themes`).filter(
      (file) => !/-stock-drag|^zoom-|-nopatch/.test(file),
    );

const pick = (files, name) => (files.includes(name) ? name : null);
const lines = [];

/**
 * One image that follows the reader's theme, as the README does: release notes
 * go through the same markdown renderer, so a <picture> with a
 * prefers-color-scheme source works there too. A capture that stands for both
 * modes is emitted as a plain image.
 */
const themedImage = (alt, light, dark) => {
  if (!dark || dark === light) {
    return [`![${alt}](${url(light)})`];
  }
  return [
    "<picture>",
    `  <source media="(prefers-color-scheme: dark)" srcset="${url(dark)}" />`,
    `  <img alt="${alt}" src="${url(light)}" />`,
    "</picture>",
  ];
};

/** The same, as one line of HTML for use inside a table cell. */
const themedImageHtml = (alt, light, dark) =>
  !dark || dark === light
    ? `<img alt="${alt}" src="${url(light)}" />`
    : `<picture><source media="(prefers-color-scheme: dark)" srcset="${url(dark)}" /><img alt="${alt}" src="${url(light)}" /></picture>`;

/** Themes laid out in a grid, so a long list is not a long scroll. */
const THEME_COLUMNS = 2;

// One capture per colour scheme, holding the custom row above the stock rows it
// is modelled on, and the edge cases beside them.
const overview = [
  ["Light", base.find((f) => /^overview-.*-light\.png$/.test(f))],
  ["Dark", base.find((f) => /^overview-.*-dark\.png$/.test(f))],
].filter(([, file]) => file);

if (overview.length) {
  const light = overview.find(([label]) => label === "Light")?.[1];
  const dark = overview.find(([label]) => label === "Dark")?.[1];
  lines.push("## Screenshots", "");
  lines.push(
    "The row above the stock `input_number` slider rows it is modelled on, then",
    "the edge cases — both handles at the ends, an inverted pair flagged in the",
    "error colour, the same pair with the warning off, equal values, and a",
    "whole-number step. The top row is held mid-drag, so the value popup and the",
    "theme's own drag treatment are both visible:",
    "",
    ...themedImage("The row, the stock rows it is modelled on, and the edge cases", light ?? dark, dark),
    "",
  );
}

if (themes.length) {
  // The sweep records what each file holds, because the names alone are
  // ambiguous: graphite-light.png is the Graphite Light theme, not Graphite in
  // light mode. A capture marked "static" is one whose light and dark resolve
  // identically, so it stands for both.
  // Grouped by theme, so a theme with separate modes becomes one image that
  // follows the reader rather than two stacked side by side.
  const byTheme = new Map();
  for (const entry of manifest) {
    const modes = byTheme.get(entry.theme) ?? {};
    modes[entry.colorScheme] = `theme-${entry.file}`;
    byTheme.set(entry.theme, modes);
  }
  const packs = byTheme.size
    ? [...byTheme.entries()]
    : themes.map((file) => [
        file.replace(/\.png$/, ""),
        { static: `theme-${file}` },
      ]);

  lines.push(
    "<details>",
    `<summary>Custom themes (${packs.length})</summary>`,
    "",
    "<table>",
  );
  for (let i = 0; i < packs.length; i += THEME_COLUMNS) {
    const row = packs.slice(i, i + THEME_COLUMNS);
    lines.push("  <tr>");
    for (const [theme, modes] of row) {
      lines.push(
        `    <td align="center" width="${Math.floor(100 / THEME_COLUMNS)}%">`,
        `      <strong>${theme}</strong><br />`,
        `      ${themedImageHtml(theme, modes.light ?? modes.static, modes.dark)}`,
        "    </td>",
      );
    }
    lines.push("  </tr>");
  }
  lines.push("</table>", "", "</details>", "");

  // Themes move independently of this card, so record what they were pinned to.
  const versionsFile = `${dir}/theme-versions.txt`;
  if (existsSync(versionsFile)) {
    const versions = readFileSync(versionsFile, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [repo, commit] = line.split(" ");
        return `- [${repo}](https://github.com/${repo}/tree/${commit}) \`${commit.slice(0, 7)}\``;
      });
    if (versions.length) {
      lines.push(
        "<details>",
        `<summary>Theme versions these were captured against (${versions.length})</summary>`,
        "",
        ...versions,
        "",
        "</details>",
        "",
      );
    }
  }
}

if (!lines.length) {
  console.error(`error: no screenshots found under ${dir}`);
  process.exit(1);
}

process.stdout.write(lines.join("\n"));
