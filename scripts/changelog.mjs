#!/usr/bin/env node
/**
 * Minimal Keep a Changelog helper, driven by the justfile.
 *
 *   node scripts/changelog.mjs unreleased          print the [Unreleased] body
 *   node scripts/changelog.mjs has-unreleased      exit 0 if it has entries, 1 if not
 *   node scripts/changelog.mjs notes <version>     print one version's body
 *   node scripts/changelog.mjs promote <version> <date>
 *                                                  move [Unreleased] to <version>
 *
 * `promote` also rewrites the link definitions at the bottom of the file so
 * [unreleased] compares against the new tag and the new version links to its
 * diff against the previous one.
 */
import { readFileSync, writeFileSync } from "node:fs";

const FILE = "CHANGELOG.md";
const FALLBACK_REPO = "https://github.com/W-Floyd/ha-range-entities-slider";
const UNRELEASED = "unreleased";

const HEADING = /^## \[([^\]]+)\](?:\s+-\s+(\S+))?\s*$/;
const LINK_REF = /^\[([^\]]+)\]:\s*(\S+)\s*$/;
const ENTRY = /^\s*[-*]\s+\S/;

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

function trimBlank(lines) {
  const out = [...lines];
  while (out.length && out[0].trim() === "") out.shift();
  while (out.length && out[out.length - 1].trim() === "") out.pop();
  return out;
}

function parse() {
  let text;
  try {
    text = readFileSync(FILE, "utf8");
  } catch {
    fail(`${FILE} not found`);
  }

  const preamble = [];
  const sections = [];
  const links = [];
  let current = null;

  for (const line of text.split("\n")) {
    const heading = HEADING.exec(line);
    if (heading) {
      current = { version: heading[1], date: heading[2] ?? null, body: [] };
      sections.push(current);
      continue;
    }
    // Link definitions are collected wherever they appear and re-emitted at the
    // bottom, so promote() does not have to care where they live.
    const link = LINK_REF.exec(line);
    if (link) {
      links.push({ name: link[1], url: link[2] });
      continue;
    }
    (current ? current.body : preamble).push(line);
  }

  return { preamble, sections, links };
}

function serialize({ preamble, sections, links }) {
  const lines = [...trimBlank(preamble)];
  for (const section of sections) {
    lines.push("");
    lines.push(
      `## [${section.version}]${section.date ? ` - ${section.date}` : ""}`,
    );
    const body = trimBlank(section.body);
    if (body.length) {
      lines.push("");
      lines.push(...body);
    }
  }
  if (links.length) {
    lines.push("");
    for (const link of links) lines.push(`[${link.name}]: ${link.url}`);
  }
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n")}\n`;
}

function findSection(sections, version) {
  const wanted = version.toLowerCase();
  return sections.find((s) => s.version.toLowerCase() === wanted);
}

function entryCount(section) {
  return section ? section.body.filter((l) => ENTRY.test(l)).length : 0;
}

function repoUrl(links) {
  for (const { url } of links) {
    const match = /^(https:\/\/github\.com\/[^/]+\/[^/]+)/.exec(url);
    if (match) return match[1];
  }
  return FALLBACK_REPO;
}

function setLink(links, name, url) {
  const existing = links.findIndex(
    (l) => l.name.toLowerCase() === name.toLowerCase(),
  );
  if (existing === -1) links.push({ name, url });
  else links[existing] = { name: links[existing].name, url };
}

function promote(version, date) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) fail(`invalid version: ${version}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail(`invalid date: ${date}`);

  const changelog = parse();
  const { sections, links } = changelog;

  if (findSection(sections, version)) {
    fail(`${FILE} already has a section for ${version}`);
  }

  const index = sections.findIndex(
    (s) => s.version.toLowerCase() === UNRELEASED,
  );
  if (index === -1) fail(`${FILE} has no [Unreleased] section`);

  const unreleased = sections[index];
  if (entryCount(unreleased) === 0) {
    fail(
      `${FILE} has no entries under [Unreleased] — describe the change there first`,
    );
  }

  const previous = sections[index + 1]?.version ?? null;
  sections.splice(index + 1, 0, {
    version,
    date,
    body: trimBlank(unreleased.body),
  });
  unreleased.body = [];

  const repo = repoUrl(links);
  setLink(links, UNRELEASED, `${repo}/compare/v${version}...HEAD`);

  const url = previous
    ? `${repo}/compare/v${previous}...v${version}`
    : `${repo}/releases/tag/v${version}`;
  const existing = links.findIndex(
    (l) => l.name.toLowerCase() === version.toLowerCase(),
  );
  if (existing !== -1) {
    links[existing] = { name: links[existing].name, url };
  } else {
    // Keep definitions newest-first, directly under [unreleased].
    const after = links.findIndex((l) => l.name.toLowerCase() === UNRELEASED);
    links.splice(after + 1, 0, { name: version, url });
  }

  writeFileSync(FILE, serialize(changelog));
  console.log(`promoted [Unreleased] to [${version}] - ${date}`);
}

const [command, ...args] = process.argv.slice(2);

switch (command) {
  case "unreleased": {
    const section = findSection(parse().sections, UNRELEASED);
    const body = trimBlank(section?.body ?? []);
    if (body.length) console.log(body.join("\n"));
    break;
  }
  case "has-unreleased": {
    const section = findSection(parse().sections, UNRELEASED);
    process.exit(entryCount(section) > 0 ? 0 : 1);
    break;
  }
  case "notes": {
    if (!args[0]) fail("usage: notes <version>");
    const section = findSection(parse().sections, args[0]);
    if (!section) fail(`${FILE} has no section for ${args[0]}`);
    console.log(trimBlank(section.body).join("\n"));
    break;
  }
  case "promote": {
    if (args.length !== 2) fail("usage: promote <version> <date>");
    promote(args[0], args[1]);
    break;
  }
  default:
    fail(
      "usage: changelog.mjs unreleased | has-unreleased | notes <version> | promote <version> <date>",
    );
}
