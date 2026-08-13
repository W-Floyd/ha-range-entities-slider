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
const themes = png(`${dir}/themes`);

const pick = (files, name) => (files.includes(name) ? name : null);
const lines = [];

const card = [
  ["Light", pick(base, "card-stable-light.png")],
  ["Dark", pick(base, "card-stable-dark.png")],
].filter(([, file]) => file);

if (card.length) {
  lines.push("## Screenshots", "");
  lines.push(
    "The row above the stock `input_number` slider rows it is modelled on:",
    "",
  );
  for (const [label, file] of card) {
    lines.push(`**${label}**`, "", `![${label}](${url(file)})`, "");
  }
}

const edges = pick(base, "edge-cases-stable-light.png");
if (edges) {
  lines.push(
    "Boundary and degenerate pairs — both handles at the ends, an inverted pair",
    "flagged in the error colour, equal values, and a whole-number step:",
    "",
    `![Edge cases](${url(edges)})`,
    "",
  );
}

if (themes.length) {
  // The sweep records what each file holds, because the names alone are
  // ambiguous: graphite-light.png is the Graphite Light theme, not Graphite in
  // light mode. A capture marked "static" is one whose light and dark resolve
  // identically, so it stands for both.
  const manifestPath = `${dir}/themes/manifest.json`;
  const manifest = existsSync(manifestPath)
    ? new Map(
        JSON.parse(readFileSync(manifestPath, "utf8")).map((entry) => [
          entry.file,
          entry,
        ]),
      )
    : new Map();
  const label = (file) => {
    const entry = manifest.get(file);
    if (!entry) return file.replace(/\.png$/, "");
    return entry.colorScheme === "static"
      ? entry.theme
      : `${entry.theme} (${entry.colorScheme})`;
  };
  lines.push(
    "<details>",
    `<summary>Custom themes (${themes.length} captures)</summary>`,
    "",
  );
  for (const file of themes) {
    lines.push(`**${label(file)}**`, "", `![${label(file)}](${url(`theme-${file}`)})`, "");
  }
  lines.push("</details>", "");
}

if (!lines.length) {
  console.error(`error: no screenshots found under ${dir}`);
  process.exit(1);
}

process.stdout.write(lines.join("\n"));
