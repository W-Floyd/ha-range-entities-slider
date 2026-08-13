/**
 * Renders the card in a real Home Assistant frontend and checks it.
 *
 * Runs inside the container built from tests/Dockerfile, launched by
 * tests/render.sh. Configured by env: HA_URL, HA_VERSION, OUT_DIR, and
 * optionally HA_TOKEN (skips onboarding) and STRICT_THUMBS.
 *
 * Checks cover what the card owns — the row mounting, the slider existing in
 * range mode, the handles picking up the entity states — plus the Material You
 * patch, which reaches into ha-slider's private shadow DOM by id and so is the
 * part most likely to break on a Home Assistant upgrade. That last check is
 * verified to pass on both stable and beta; set STRICT_THUMBS=0 to downgrade it
 * to a warning if upstream churn makes it noisy.
 */
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const HA_URL = process.env.HA_URL ?? "http://ha:8123";
const HA_VERSION = process.env.HA_VERSION ?? "stable";
const OUT_DIR = process.env.OUT_DIR ?? "/out";
const STRICT_THUMBS = (process.env.STRICT_THUMBS ?? "1") !== "0";
const SWEEP_THEMES = process.env.SWEEP_THEMES === "1";
const STRICT_THEMES = (process.env.STRICT_THEMES ?? "1") !== "0";
const THEME_FILTER = process.env.THEME_FILTER ?? "";
const ALL_THEMES = process.env.ALL_THEMES === "1";

/**
 * The installed packs expand to well over a hundred themes — every iOS accent
 * colour, every Catppuccin flavour. Sweeping all of them says little more than
 * a representative light/dark pair from each pack, so this is the default set.
 * ALL_THEMES=1 sweeps everything; THEME_FILTER=a,b matches by substring.
 */
const CURATED_THEMES = [
  "Material You",
  "Catppuccin Latte",
  "Catppuccin Mocha",
  "Liquid Glass",
  "visionos",
  "Metro Blue",
  "Fluent Slate",
  "Graphite",
  "Graphite Light",
  "ios-light-mode-light-blue",
  "ios-dark-mode-dark-blue",
  "macOS Theme",
];

/** Scaffolding themes the packs ship for inheritance, not for use. */
const EXCLUDED_THEMES = /do not use|common base/i;
const CLIENT_ID = `${HA_URL}/`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForHomeAssistant() {
  const deadline = Date.now() + 300_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${HA_URL}/manifest.json`);
      if (response.ok) return;
    } catch {
      // not up yet
    }
    await sleep(2000);
  }
  throw new Error(`Home Assistant at ${HA_URL} never became ready`);
}

async function onboard() {
  const users = await fetch(`${HA_URL}/api/onboarding/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      name: "Render Bot",
      username: "render",
      password: "render-password",
      language: "en",
    }),
  });
  if (!users.ok) {
    throw new Error(
      `onboarding/users failed: ${users.status} ${await users.text()}`,
    );
  }
  const { auth_code: code } = await users.json();

  const tokens = await fetch(`${HA_URL}/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: CLIENT_ID,
    }),
  });
  if (!tokens.ok) {
    throw new Error(
      `auth/token failed: ${tokens.status} ${await tokens.text()}`,
    );
  }
  const { access_token: token } = await tokens.json();

  // Remaining steps are tolerated individually: which ones exist, and whether
  // they are already satisfied, varies between Home Assistant versions.
  const steps = [
    ["core_config", {}],
    ["analytics", {}],
    [
      "integration",
      { client_id: CLIENT_ID, redirect_uri: `${CLIENT_ID}?auth_callback=1` },
    ],
  ];
  for (const [step, body] of steps) {
    try {
      await fetch(`${HA_URL}/api/onboarding/${step}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
    } catch {
      // best effort
    }
  }

  return token;
}

/** Theme names Home Assistant has loaded, via the websocket API. */
async function getThemeNames(token) {
  const url = `${HA_URL.replace(/^http/, "ws")}/api/websocket`;
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error("timed out asking for themes"));
    }, 30_000);

    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.type === "auth_required") {
        socket.send(JSON.stringify({ type: "auth", access_token: token }));
      } else if (message.type === "auth_ok") {
        socket.send(JSON.stringify({ id: 1, type: "frontend/get_themes" }));
      } else if (message.type === "auth_invalid") {
        clearTimeout(timer);
        socket.close();
        reject(new Error("websocket auth failed"));
      } else if (message.type === "result") {
        clearTimeout(timer);
        socket.close();
        resolve(Object.keys(message.result?.themes ?? {}).sort());
      }
    });
    socket.addEventListener("error", (event) => {
      clearTimeout(timer);
      reject(new Error(`websocket error: ${event?.message ?? "unknown"}`));
    });
  });
}

async function setTheme(token, name) {
  const response = await fetch(`${HA_URL}/api/services/frontend/set_theme`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ name }),
  });
  if (!response.ok) {
    throw new Error(
      `set_theme(${name}) failed: ${response.status} ${await response.text()}`,
    );
  }
}

/**
 * Does the range handle get a painted surface under this theme?
 *
 * The patch draws the handle as a ::before bar coloured with
 * --md-sys-color-primary, which only the Material You theme defines. Under
 * other themes nothing paints, and the handle position reads only as a small
 * gap in the track — legible, but weaker than the round knob the stock
 * input_number row gets. Measured with the patch detached too, so the result is
 * attributed correctly: Home Assistant does not paint it either.
 */
const HANDLE_PROBE = (el) => {
  const slider = el.shadowRoot?.querySelector("ha-slider");
  const sliderShadow = slider?.shadowRoot;
  const thumb = sliderShadow?.querySelector("#thumb-min");
  if (!thumb) return { thumb: false, painted: false };

  const opaque = (color) =>
    !!color &&
    color !== "transparent" &&
    !/rgba\([^)]*,\s*0\)$/.test(color.replace(/\s/g, " "));

  const measure = () => {
    const thumbStyle = getComputedStyle(thumb);
    const barStyle = getComputedStyle(thumb, "::before");
    return {
      thumbBackground: thumbStyle.backgroundColor,
      barBackground: barStyle.backgroundColor,
      barWidth: barStyle.width,
      // Either surface being opaque means the handle has a painted body.
      painted:
        opaque(thumbStyle.backgroundColor) || opaque(barStyle.backgroundColor),
    };
  };

  const withFix = measure();

  // Measure again with the patch detached, to attribute an invisible handle to
  // the card's own styling rather than to Home Assistant's slider.
  const patch = sliderShadow.querySelector("#range-slider-fix");
  let withoutFix = null;
  if (patch) {
    patch.remove();
    withoutFix = measure();
    sliderShadow.appendChild(patch);
  }

  return { thumb: true, fix: !!patch, ...withFix, withoutFix };
};

const failures = [];
const warnings = [];

function expect(condition, message) {
  if (condition) console.log(`ok: ${message}`);
  else failures.push(message);
}

console.log(`==> waiting for Home Assistant (${HA_VERSION}) at ${HA_URL}`);
await waitForHomeAssistant();

const token = process.env.HA_TOKEN || (await onboard());
console.log("==> onboarded");

mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch();

try {
  for (const colorScheme of ["light", "dark"]) {
    const context = await browser.newContext({
      viewport: { width: 900, height: 700 },
      colorScheme,
      deviceScaleFactor: 2,
    });

    // Seed the token so the frontend skips the login screen entirely.
    await context.addInitScript(
      ({ url, value }) => {
        window.localStorage.setItem(
          "hassTokens",
          JSON.stringify({
            access_token: value,
            token_type: "Bearer",
            expires_in: 1800,
            hassUrl: url,
            clientId: `${url}/`,
            expires: Date.now() + 1800 * 1000,
            refresh_token: "",
          }),
        );
      },
      { url: HA_URL, value: token },
    );

    const page = await context.newPage();
    page.on("pageerror", (error) =>
      warnings.push(
        `page error: ${error?.message || error?.stack || JSON.stringify(error)}`,
      ),
    );

    await page.goto(`${HA_URL}/lovelace/0`, { waitUntil: "domcontentloaded" });

    // Playwright's css engine pierces open shadow roots, so the row is
    // reachable without walking the frontend's element tree by hand.
    const row = page.locator("range-entity-row");
    await row.waitFor({ state: "attached", timeout: 60_000 });
    await page
      .locator("range-entity-row ha-slider")
      .waitFor({ state: "attached", timeout: 30_000 });

    // Let the slider's shadow DOM settle, including the card's 50ms patch.
    await page.waitForTimeout(750);

    const probe = await row.evaluate((el) => {
      const shadow = el.shadowRoot;
      const slider = shadow?.querySelector("ha-slider");
      const sliderShadow = slider?.shadowRoot;
      return {
        genericRow: !!shadow?.querySelector("hui-generic-entity-row"),
        hasSlider: !!slider,
        isRange: slider?.hasAttribute("range") ?? false,
        min: slider?.min,
        max: slider?.max,
        step: slider?.step,
        minValue: slider?.minValue,
        maxValue: slider?.maxValue,
        stateText: shadow?.querySelector(".state")?.textContent?.trim() ?? "",
        sliderShadowIds: sliderShadow
          ? [...sliderShadow.querySelectorAll("[id]")].map((n) => n.id)
          : [],
        thumbMin: !!sliderShadow?.querySelector("#thumb-min"),
        thumbMax: !!sliderShadow?.querySelector("#thumb-max"),
        fixApplied: !!sliderShadow?.querySelector("#range-slider-fix"),
      };
    });

    // The dashboard also holds stock hui-input-number-entity-row rows for the
    // same entities, so the screenshots compare against what HA itself renders.
    const stockRow = page.locator("hui-input-number-entity-row").first();
    await stockRow.waitFor({ state: "attached", timeout: 30_000 });

    if (colorScheme === "light") {
      const [customBox, stockBox] = await Promise.all([
        row.boundingBox(),
        stockRow.boundingBox(),
      ]);
      console.log(
        `\ngeometry: custom row ${customBox?.width}x${customBox?.height}, ` +
          `stock row ${stockBox?.width}x${stockBox?.height}`,
      );
      expect(
        !!customBox && customBox.width > 0 && customBox.height > 0,
        "custom row occupies space in the layout",
      );
      expect(
        !!stockBox && Math.abs((customBox?.width ?? 0) - stockBox.width) < 2,
        "custom row is the same width as the stock slider row",
      );

      console.log(`\n--- probe (HA ${HA_VERSION}) ---`);
      console.log(JSON.stringify(probe, null, 2));
      console.log("---\n");

      expect(probe.genericRow, "row renders hui-generic-entity-row");
      expect(probe.hasSlider, "row renders an ha-slider");
      expect(probe.isRange, "slider is in range mode");
      expect(probe.min === 15 && probe.max === 30, "min/max come from entities");
      expect(probe.step === 0.5, "step comes from the entities");
      expect(
        probe.minValue === 18 && probe.maxValue === 24,
        "handles reflect the entity states (18 / 24)",
      );
      expect(
        probe.stateText.includes("18") && probe.stateText.includes("24"),
        "readout shows both values",
      );

      const thumbs = probe.thumbMin && probe.thumbMax;
      const summary = `Material You patch: #thumb-min/#thumb-max present=${thumbs}, style injected=${probe.fixApplied}`;
      if (thumbs && probe.fixApplied) {
        console.log(`ok: ${summary}`);
      } else if (STRICT_THUMBS) {
        failures.push(summary);
      } else {
        warnings.push(
          `${summary} — ha-slider shadow ids are [${probe.sliderShadowIds.join(", ")}]`,
        );
      }
    }

    for (const [name, locator] of [
      ["row", row],
      ["stock-row", stockRow],
      ["card", page.locator("hui-entities-card")],
    ]) {
      const file = `${OUT_DIR}/${name}-${HA_VERSION}-${colorScheme}.png`;
      await locator.screenshot({ path: file });
      console.log(`saved ${file}`);
    }

    await context.close();
  }

  if (SWEEP_THEMES) {
    const installed = (await getThemeNames(token)).filter(
      (name) => !EXCLUDED_THEMES.test(name),
    );

    let themes;
    if (THEME_FILTER) {
      const wanted = THEME_FILTER.split(",").map((s) => s.trim().toLowerCase());
      themes = installed.filter((name) =>
        wanted.some((w) => name.toLowerCase().includes(w)),
      );
    } else if (ALL_THEMES) {
      themes = installed;
    } else {
      const available = new Map(installed.map((name) => [name.toLowerCase(), name]));
      themes = CURATED_THEMES.map((name) => available.get(name.toLowerCase())).filter(
        Boolean,
      );
      // A curated name that stops resolving means a pack renamed its themes.
      const missing = CURATED_THEMES.filter(
        (name) => !available.has(name.toLowerCase()),
      );
      if (missing.length) {
        warnings.push(`curated themes not installed: ${missing.join(", ")}`);
      }
      console.log(
        `\n==> ${installed.length} theme(s) installed; sweeping ${themes.length} curated (ALL_THEMES=1 for all)`,
      );
    }
    if (themes.length === 0) {
      warnings.push("theme sweep requested but no themes matched");
    }

    const themeDir = `${OUT_DIR}/themes`;
    mkdirSync(themeDir, { recursive: true });
    const results = [];

    for (const colorScheme of ["light", "dark"]) {
      const context = await browser.newContext({
        viewport: { width: 900, height: 700 },
        colorScheme,
        deviceScaleFactor: 2,
      });
      await context.addInitScript(
        ({ url, value }) => {
          window.localStorage.setItem(
            "hassTokens",
            JSON.stringify({
              access_token: value,
              token_type: "Bearer",
              expires_in: 1800,
              hassUrl: url,
              clientId: `${url}/`,
              expires: Date.now() + 1800 * 1000,
              refresh_token: "",
            }),
          );
        },
        { url: HA_URL, value: token },
      );
      const page = await context.newPage();

      for (const theme of themes) {
        await setTheme(token, theme);
        await page.goto(`${HA_URL}/lovelace/0`, {
          waitUntil: "domcontentloaded",
        });

        const row = page.locator("range-entity-row");
        try {
          await row.waitFor({ state: "attached", timeout: 30_000 });
          await page.waitForTimeout(750);
        } catch {
          results.push({ theme, colorScheme, error: "row never appeared" });
          continue;
        }

        const handles = await row.evaluate(HANDLE_PROBE);
        results.push({ theme, colorScheme, ...handles });

        const slug = theme.toLowerCase().replace(/[^a-z0-9]+/g, "-");
        await page
          .locator("hui-entities-card")
          .screenshot({ path: `${themeDir}/${slug}-${colorScheme}.png` });
      }

      await context.close();
    }

    console.log("\n--- handle rendering by theme ---");
    const width = Math.max(...results.map((r) => r.theme.length), 5);
    for (const result of results) {
      const status = result.error
        ? `ERROR ${result.error}`
        : result.painted
          ? "painted handle"
          : "gap only (no painted handle" +
            (result.withoutFix && !result.withoutFix.painted
              ? ", same without the patch)"
              : ")");
      console.log(
        `${result.theme.padEnd(width)}  ${result.colorScheme.padEnd(5)}  ${status}`,
      );
    }

    const unpainted = results.filter((r) => !r.error && !r.painted);
    const summary =
      `${unpainted.length}/${results.length} theme+mode combinations draw the handle as a ` +
      `track gap only, with no painted handle`;
    console.log(`\n${summary}`);
    console.log(`screenshots in ${themeDir}`);
    if (unpainted.length) {
      if (STRICT_THEMES) failures.push(summary);
      else warnings.push(summary);
    }
  }
} finally {
  await browser.close();
}

for (const warning of warnings) console.warn(`warning: ${warning}`);

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed:`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log("\nall render checks passed");
