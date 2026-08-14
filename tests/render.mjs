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
import {
  existsSync,
  mkdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
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
  "LCARS Default",
  "Frosted Glass",
  "Frosted Glass Dark",
  "Pip-Boy",
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

/**
 * The themes Home Assistant has loaded, via the websocket API, each with
 * whether it declares its own light/dark modes. A theme that does not is
 * rendered identically whatever the browser prefers, so it only needs one pass.
 */
async function getThemes(token) {
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
        const themes = message.result?.themes ?? {};
        resolve(
          Object.keys(themes)
            .sort()
            .map((name) => ({
              name,
              // HA nests per-mode overrides under `modes: {light, dark}`.
              hasModes: !!(
                themes[name]?.modes?.light || themes[name]?.modes?.dark
              ),
            })),
        );
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
/**
 * What the theme actually resolves to for this row. Themes that declare their
 * colours outright — or declare light and dark modes with identical values —
 * render the same whichever mode the browser asks for, so this is what decides
 * whether a second capture is worth taking.
 */
const APPEARANCE_PROBE = (el) => {
  const style = getComputedStyle(el);
  const sliderShadow = el.shadowRoot?.querySelector("ha-slider")?.shadowRoot;
  const part = (selector) => {
    const node = sliderShadow?.querySelector(selector);
    return node ? getComputedStyle(node).backgroundColor : "";
  };
  return [
    style.color,
    style.backgroundColor,
    ...[
      "--primary-color",
      "--slider-color",
      "--card-background-color",
      "--primary-text-color",
      "--md-sys-color-primary",
      "--ha-slider-thumb-negative-color",
    ].map((name) => style.getPropertyValue(name).trim()),
    part("#track"),
    part("#indicator"),
    part("#thumb-min"),
  ].join("|");
};

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

  const indicator = sliderShadow.querySelector("#indicator");
  const indicatorRadius = indicator
    ? getComputedStyle(indicator).borderRadius
    : null;
  const indicatorMargin = indicator
    ? `${getComputedStyle(indicator).marginInlineStart} ${getComputedStyle(indicator).marginInlineEnd}`
    : null;

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

  return {
    thumb: true,
    fix: !!patch,
    indicatorRadius,
    indicatorMargin,
    ...withFix,
    withoutFix,
  };
};

/**
 * Captures the dashboard the same way everywhere: clipped to the cards plus a
 * margin, since the view element runs the full height of the viewport and would
 * otherwise leave most of the image empty.
 */
let DRAG_RESET_TOKEN = "";

/**
 * The captures and the drag tests move handles, which writes to the entities.
 * Nothing should be able to tell afterwards: the dashboard is documented by its
 * values, and a capture that left them changed would drift every run.
 */
const DOCUMENTED_VALUES = {
  "input_number.drag_low": 18,
  "input_number.drag_high": 24,
  "input_number.lower_temp": 18,
  "input_number.upper_temp": 24,
  "input_number.narrow_low": 16,
  "input_number.narrow_high": 28,
};

async function restoreValues() {
  await Promise.all(
    Object.entries(DOCUMENTED_VALUES).map(([entity_id, value]) =>
      fetch(`${HA_URL}/api/services/input_number/set_value`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${DRAG_RESET_TOKEN}`,
        },
        body: JSON.stringify({ entity_id, value }),
      }),
    ),
  );
}

async function captureOverview(page, file) {
  // Home Assistant raises a "started" toast on boot which would otherwise sit
  // across the bottom of every capture.
  await page.evaluate(() => {
    const manager = document
      .querySelector("home-assistant")
      ?.shadowRoot?.querySelector("notification-manager");
    if (manager) manager.style.display = "none";
  });
  // A row that renders a warning draws outside its card's box, so the warnings
  // are measured too rather than being cropped off the bottom.
  const cards = await page
    .locator("hui-entities-card, hui-warning")
    .evaluateAll((nodes) =>
      nodes.map((n) => {
        const r = n.getBoundingClientRect();
        return { x: r.x, y: r.y, right: r.right, bottom: r.bottom };
      }),
    );
  // Hold a drag on the row set aside for it, so every capture shows the value
  // popup and whatever the theme does to a handle while it is being moved. The
  // pointer returns to where it started before releasing, so the entities are
  // left as they were.
  const dragIndex = await page
    .locator("range-entity-row")
    .evaluateAll((rows) => rows.findIndex((el) => el.config?.name === "Dragging"));
  let dragFrom = null;
  if (dragIndex >= 0) {
    dragFrom = await page
      .locator("range-entity-row")
      .nth(dragIndex)
      .evaluate((el) => {
        const node = el.shadowRoot
          ?.querySelector("ha-slider")
          ?.shadowRoot?.querySelector("#thumb-max");
        const r = node?.getBoundingClientRect();
        return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
      });
    if (dragFrom) {
      await page.mouse.move(dragFrom.x, dragFrom.y);
      await page.mouse.down();
      // A single pixel: enough to raise the popup and the theme's held styling,
      // too little to cross a step, so the capture still shows the documented
      // value and the entity is never actually written.
      await page.mouse.move(dragFrom.x + 1, dragFrom.y, { steps: 2 });
      await page.waitForTimeout(400);
    }
  }

  const pad = 12;
  const clip = cards.length
    ? {
        x: Math.max(0, Math.min(...cards.map((c) => c.x)) - pad),
        y: Math.max(0, Math.min(...cards.map((c) => c.y)) - pad),
        width:
          Math.max(...cards.map((c) => c.right)) -
          Math.min(...cards.map((c) => c.x)) +
          pad * 2,
        height:
          Math.max(...cards.map((c) => c.bottom)) -
          Math.min(...cards.map((c) => c.y)) +
          pad * 2,
      }
    : undefined;
  await page.screenshot({ path: file, clip });

  // The same capture with a stock row held mid-drag instead, so the two can be
  // compared in the state that only exists during a gesture. Nothing publishes
  // these — they are for diffing ours against stock while working on the handle
  // styling — and they double the number of captures a sweep takes, so they are
  // opt-in rather than something CI spends its time on.
  if (dragFrom && process.env.DIAGNOSE_STOCK_DRAG === "1") {
    await page.mouse.move(dragFrom.x, dragFrom.y, { steps: 4 });
    await page.mouse.up();
    const stockThumb = await page
      .locator("hui-input-number-entity-row")
      .first()
      .evaluate((el) => {
        const node = el.shadowRoot
          ?.querySelector("ha-slider")
          ?.shadowRoot?.querySelector("#thumb");
        const r = node?.getBoundingClientRect();
        return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
      })
      .catch(() => null);
    if (stockThumb) {
      await page.mouse.move(stockThumb.x, stockThumb.y);
      await page.mouse.down();
      await page.mouse.move(stockThumb.x + 1, stockThumb.y, { steps: 2 });
      await page.waitForTimeout(400);
      await page.screenshot({
        path: file.replace(/\.png$/, "-stock-drag.png"),
        clip,
      });
      await page.mouse.move(stockThumb.x, stockThumb.y, { steps: 6 });
      await page.mouse.up();
      await restoreValues();
      await page.waitForTimeout(300);
    }
    await page.mouse.move(dragFrom.x, dragFrom.y);
    await page.mouse.down();
  }

  if (dragFrom) {
    await page.mouse.move(dragFrom.x, dragFrom.y, { steps: 6 });
    await page.mouse.up();
    // The handle narrows under some themes while it is being dragged, so the
    // pointer landing back where it started does not put the value back.
    await restoreValues();
    await page.waitForTimeout(300);
  }
}

const failures = [];
const warnings = [];

// Warnings are reported together at the end, so a page error on its own says
// nothing about what the page was doing when it threw. This says which step
// was in progress, which is how an error is attributed to the card rather than
// to Home Assistant's own boot.
let phase = "boot";
const setPhase = (next) => {
  phase = next;
};

/**
 * Errors Home Assistant throws at itself while the page comes up, which are
 * reported as a count rather than one line each so a real error from the card
 * cannot hide among them. Both were traced to the frontend's own code:
 *
 * - ha-entity-picker's render() reads this._i18n.localize unguarded, and _i18n
 *   is a Lit context it consumes rather than a property it is passed, so its
 *   first render can land before the provider on <home-assistant> answers.
 *   Two fire per page load, from pickers Home Assistant mounts itself.
 * - a websocket command this build's backend does not implement, rejecting with
 *   "Unknown command."
 *
 * Anything outside boot, and anything else during it, is reported in full.
 */
const KNOWN_BOOT_NOISE = [
  /Cannot read properties of undefined \(reading 'localize'\)/,
];

/**
 * The same, but not tied to boot: a websocket command the frontend sends that
 * this build's backend does not implement, which rejects with an object rather
 * than an Error. It settles whenever the response arrives, so it lands in
 * whichever step happens to be running. Playwright reports it twice — once as a
 * page error whose message is the useless "Object", and once through the
 * serialiser above — so both shapes are matched. Which command it is went
 * unidentified: the reason carries only a code, and no failing response frame
 * could be matched back to a sent command.
 */
const KNOWN_NOISE = [
  /unhandled rejection: \{"code":"unknown_command"/,
  /page error during [^:]*: Object$/,
];
let knownNoise = 0;
const record = (message) => {
  const known =
    KNOWN_NOISE.some((re) => re.test(message)) ||
    (phase === "boot" && KNOWN_BOOT_NOISE.some((re) => re.test(message)));
  if (known) {
    knownNoise += 1;
    return;
  }
  warnings.push(message);
};

function expect(condition, message) {
  if (condition) console.log(`ok: ${message}`);
  else failures.push(message);
}

console.log(`==> waiting for Home Assistant (${HA_VERSION}) at ${HA_URL}`);
await waitForHomeAssistant();

const token = process.env.HA_TOKEN || (await onboard());
DRAG_RESET_TOKEN = token;
console.log("==> onboarded");

// The tag says "stable"; this says which release that resolved to, which is
// what the skip-if-unchanged check and the release notes actually care about.
const config = await (
  await fetch(`${HA_URL}/api/config`, {
    headers: { Authorization: `Bearer ${token}` },
  })
).json();
const haVersion = config?.version ?? "unknown";
console.log(`==> Home Assistant ${haVersion} (tag: ${HA_VERSION})`);

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(
  `${OUT_DIR}/render-info.json`,
  `${JSON.stringify({ haVersion, haTag: HA_VERSION }, null, 2)}\n`,
);

const browser = await chromium.launch();

try {
  for (const colorScheme of ["light", "dark"]) {
    const context = await browser.newContext({
      viewport: { width: 1400, height: 1200 },
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
    // A rejection whose reason is not an Error arrives as the bare message
    // "Object", which says nothing at all. Serialising it in the page is the
    // only place the reason's own properties are still reachable.
    await page.addInitScript(() => {
      window.addEventListener("unhandledrejection", (event) => {
        const reason = event.reason;
        if (reason instanceof Error) return;
        let detail;
        try {
          detail = JSON.stringify(
            reason,
            reason && typeof reason === "object"
              ? Object.getOwnPropertyNames(reason)
              : undefined,
          );
        } catch {
          detail = String(reason);
        }
        console.error(`unhandled rejection: ${detail}`);
      });
    });
    // Which websocket command a rejection came from. The reason carries only a
    // code and a message, so the failing response is matched back to the
    // command that was sent by its id.
    if (process.env.DIAGNOSE_ERRORS === "1") {
      page.on("websocket", (ws) => {
        const sent = new Map();
        ws.on("framesent", ({ payload }) => {
          try {
            const message = JSON.parse(payload.toString());
            if (message.id) sent.set(message.id, message.type);
          } catch {}
        });
        ws.on("framereceived", ({ payload }) => {
          try {
            const message = JSON.parse(payload.toString());
            if (message.success === false) {
              record(
                `websocket command "${sent.get(message.id) ?? "?"}" failed: ${message.error?.code} (during ${phase})`,
              );
            }
          } catch {}
        });
      });
    }
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      const text = message.text();
      if (text.startsWith("unhandled rejection:")) {
        record(`${text} (during ${phase})`);
      }
    });
    page.on("pageerror", (error) => {
      // The first stack frame says which component threw, which a bare message
      // does not.
      const frames = (error?.stack ?? "")
        .split("\n")
        .slice(1, process.env.DIAGNOSE_ERRORS === "1" ? 8 : 2)
        .map((line) => line.trim())
        .filter(Boolean);
      record(
        `page error during ${phase}: ${error?.message || JSON.stringify(error)}${
          frames.length ? ` (${frames.join(" <- ")})` : ""
        }`,
      );
    });

    await page.goto(`${HA_URL}/lovelace/0`, { waitUntil: "domcontentloaded" });

    // Playwright's css engine pierces open shadow roots, so the row is
    // reachable without walking the frontend's element tree by hand.
    const row = page.locator("range-entity-row").first();
    await row.waitFor({ state: "attached", timeout: 60_000 });
    await page
      .locator("range-entity-row ha-slider")
      .first()
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
        indicatorRadius: sliderShadow?.querySelector("#indicator")
          ? getComputedStyle(sliderShadow.querySelector("#indicator")).borderRadius
          : null,
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

      // Under a non-material-you theme the handle should be indistinguishable
      // from the knob on the stock row: same size, shape and colour.
      const [handle, knob] = await Promise.all([
        row.evaluate((el) => {
          const thumb = el.shadowRoot
            ?.querySelector("ha-slider")
            ?.shadowRoot?.querySelector("#thumb-min");
          if (!thumb) return null;
          const style = getComputedStyle(thumb);
          return {
            size: `${style.width}x${style.height}`,
            background: style.backgroundColor,
            radius: style.borderRadius,
            border: style.border,
          };
        }),
        stockRow.evaluate((el) => {
          const thumb = el.shadowRoot
            ?.querySelector("ha-slider")
            ?.shadowRoot?.querySelector("#thumb");
          if (!thumb) return null;
          const style = getComputedStyle(thumb);
          return {
            size: `${style.width}x${style.height}`,
            background: style.backgroundColor,
            radius: style.borderRadius,
            border: style.border,
          };
        }),
      ]);
      console.log(
        `handle: ${JSON.stringify(handle)}\n  knob: ${JSON.stringify(knob)}`,
      );

      expect(
        !!handle && !!knob && handle.size === knob.size,
        `handle is the same size as the stock knob (${handle?.size} vs ${knob?.size})`,
      );
      expect(
        !!handle && !!knob && handle.background === knob.background,
        `handle is the same colour as the stock knob (${handle?.background} vs ${knob?.background})`,
      );
      expect(
        !!handle && !!knob && handle.radius === knob.radius,
        `handle is the same shape as the stock knob (${handle?.radius} vs ${knob?.radius})`,
      );
      // Range thumbs ship a 1px white border the stock knob lacks; unhandled it
      // shows as a white ring around a shrunken dot.
      expect(
        !!handle && !!knob && handle.border === knob.border,
        `handle has no border the stock knob lacks (${handle?.border} vs ${knob?.border})`,
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

      // The readout should format exactly like the stock rows: decimals from
      // each entity's step, and the user's locale number format.
      const stockValues = await page
        .locator("hui-input-number-entity-row")
        .evaluateAll((rows) =>
          rows.map(
            (r) =>
              r.shadowRoot
                ?.querySelector(".state")
                ?.textContent?.replace(/\s+/g, " ")
                .trim() ?? "",
          ),
        );
      const ourValues = await row.evaluate((el) =>
        [...(el.shadowRoot?.querySelectorAll(".state") ?? [])]
          .map((n) => n.innerHTML)
          .join("")
          .split(/<br\s*\/?>/)
          .map((part) =>
            part
              .replace(/<[^>]*>/g, "")
              .replace(/&nbsp;|\u00a0/g, " ")
              .replace(/\s+/g, " ")
              .trim(),
          ),
      );
      console.log(
        `readout: ${JSON.stringify(ourValues)} vs stock ${JSON.stringify(stockValues)}`,
      );
      expect(
        ourValues.length === 2 &&
          stockValues.length === 2 &&
          ourValues[0] === stockValues[0] &&
          ourValues[1] === stockValues[1],
        `readout formats like the stock rows (${ourValues.join(" / ")} vs ${stockValues.join(" / ")})`,
      );

      // Boundary and degenerate pairs from the second card.
      const edges = await page.locator("range-entity-row").evaluateAll((rows) =>
        rows.map((el) => {
          const shadow = el.shadowRoot;
          const slider = shadow?.querySelector("ha-slider");
          const icon = shadow?.querySelector("ha-icon.inverted-warning");
          return {
            warningRow: shadow?.querySelector("hui-warning")?.textContent?.trim() ?? null,
            collapsed: slider?.hasAttribute("collapsed") ?? null,
            sliderDisabled: slider?.hasAttribute("disabled") ?? null,
            name: el.config?.name ?? null,
            entity: el.config?.entity ?? null,
            rangeEntity: el.config?.range_entity ?? null,
            warningIcon: icon?.getAttribute("icon") ?? null,
            warningColor: icon ? getComputedStyle(icon).color : null,
            warningTitle: icon?.getAttribute("title") ?? null,
            stateColor: shadow?.querySelector(".state")
              ? getComputedStyle(shadow.querySelector(".state")).color
              : null,
            errorColor: getComputedStyle(el)
              .getPropertyValue("--error-color")
              .trim(),
            min: slider?.min,
            max: slider?.max,
            minValue: slider?.minValue,
            maxValue: slider?.maxValue,
            state: (shadow?.querySelector(".state")?.innerHTML ?? "")
              .split(/<br\s*\/?>/)
              .map((part) =>
                part
                  .replace(/<[^>]*>/g, "")
                  .replace(/&nbsp;|\u00a0/g, " ")
                  .replace(/\s+/g, " ")
                  .trim(),
              ),
          };
        }),
      );
      const byEntity = Object.fromEntries(
        edges.map((e) => [e.entity?.replace("input_number.", ""), e]),
      );
      const byName = Object.fromEntries(edges.map((e) => [e.name, e]));
      console.log(`\n--- rows ---\n${JSON.stringify(byEntity, null, 1)}\n---\n`);

      const span = byEntity.span_low;
      expect(
        span?.minValue === span?.min && span?.maxValue === span?.max,
        `handles pinned to both ends stay there (${span?.minValue}/${span?.maxValue} of ${span?.min}-${span?.max})`,
      );

      // The entity behind the lower handle holds 24 and the upper holds 18.
      // The slider has to take them in order, but the readout shows them as the
      // entities hold them, flagged in the error colour.
      const inverted = byName["Inverted (upper < lower)"];
      expect(
        inverted?.minValue === 18 && inverted?.maxValue === 24,
        `inverted pair drives the slider in order (${inverted?.minValue}/${inverted?.maxValue})`,
      );
      expect(
        inverted?.state?.[0] === "24.0 °C" && inverted?.state?.[1] === "18.0 °C",
        `inverted readout shows the entities' own values (${inverted?.state?.join(" / ")})`,
      );
      expect(
        inverted?.warningIcon === "mdi:alert-circle",
        `inverted row shows an exclamation icon (${inverted?.warningIcon})`,
      );
      expect(
        !!inverted?.warningTitle?.includes("is above"),
        "inverted warning explains itself on hover",
      );
      expect(
        !!inverted?.warningColor &&
          inverted.warningColor === inverted.stateColor &&
          inverted.warningColor !== "rgb(0, 0, 0)",
        `inverted row is coloured with the error colour (${inverted?.warningColor}, theme --error-color ${inverted?.errorColor})`,
      );

      // The visual editor, instantiated the way hui-row-element-editor does:
      // resolve the row's class, ask it for a config element, and drive it.
      const editor = await page.evaluate(async () => {
        const rowClass = customElements.get("range-entity-row");
        if (!rowClass?.getConfigElement) return { supported: false };

        const element = rowClass.getConfigElement();
        element.hass = document.querySelector("home-assistant").hass;
        element.setConfig({
          type: "custom:range-entity-row",
          entity: "input_number.lower_temp",
          range_entity: "input_number.upper_temp",
          name: "Temperature Range",
        });
        document.body.append(element);
        await element.updateComplete;
        // ha-form renders a row per schema entry once it has hass.
        await new Promise((resolve) => setTimeout(resolve, 600));

        const form = element.shadowRoot?.querySelector("ha-form");
        const fields = [...(form?.shadowRoot?.querySelectorAll("ha-selector") ?? [])];
        const changes = [];
        element.addEventListener("config-changed", (event) =>
          changes.push(event.detail.config),
        );
        // What the editor emits when a field is edited.
        form?.dispatchEvent(
          new CustomEvent("value-changed", {
            detail: {
              value: {
                entity: "input_number.lower_temp",
                range_entity: "input_number.upper_temp",
                name: "Renamed",
                warn_inverted: false,
              },
            },
          }),
        );
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Is the editor's toggle the same component Home Assistant uses in a
        // row, and does it compute to the same styling?
        const describeSwitch = (node) => {
          if (!node) return null;
          const style = getComputedStyle(node);
          return {
            tag: node.tagName.toLowerCase(),
            checked: node.checked ?? null,
            width: style.width,
            height: style.height,
            trackColor: style.getPropertyValue("--mdc-theme-secondary").trim(),
          };
        };
        const deepFind = (root, tag) => {
          const stack = [root];
          while (stack.length) {
            const node = stack.pop();
            if (node?.tagName?.toLowerCase() === tag) return node;
            stack.push(...(node?.children ?? []));
            if (node?.shadowRoot) stack.push(node.shadowRoot);
          }
          return null;
        };
        const toggles = {
          editor: describeSwitch(deepFind(element.shadowRoot, "ha-switch")),
        };
        const result = {
          toggles,
          supported: true,
          tag: element.tagName.toLowerCase(),
          hasForm: !!form,
          fieldCount: fields.length,
          schema: (form?.schema ?? []).map((entry) => entry.name),
          emitted: changes[0] ?? null,
        };
        element.remove();
        return result;
      });
      console.log(`\neditor: ${JSON.stringify(editor)}`);

      expect(
        editor.supported && editor.tag === "range-entity-row-editor",
        `the row offers a visual editor (${editor.tag})`,
      );
      expect(
        editor.hasForm && editor.fieldCount >= 5,
        `the editor renders a field per option (${editor.fieldCount})`,
      );
      expect(
        JSON.stringify(editor.schema) ===
          JSON.stringify([
            "entity",
            "range_entity",
            "name",
            "icon",
            "warn_inverted",
          ]),
        `the editor covers every documented option (${editor.schema?.join(", ")})`,
      );
      expect(
        editor.emitted?.name === "Renamed" &&
          editor.emitted?.warn_inverted === false,
        `editing a field emits the new config (${JSON.stringify(editor.emitted)})`,
      );
      // The controls should be Home Assistant's own, not hand-rolled: the same
      // ha-switch it uses everywhere else.
      expect(
        editor.toggles?.editor?.tag === "ha-switch",
        `the editor uses Home Assistant's own controls (${editor.toggles?.editor?.tag})`,
      );

      // A row for an entity Home Assistant does not have must say so rather
      // than rendering nothing, which is indistinguishable from being absent.
      const gone = byName["Missing entity"];
      expect(
        !!gone?.warningRow?.includes("input_number.does_not_exist"),
        `a missing entity renders a warning naming it (${gone?.warningRow})`,
      );

      // An unavailable entity keeps its row, with the slider disabled, its own
      // state spelled out, and its partner's value intact rather than NaN.
      const offline = byName["Unavailable entity"];
      expect(
        offline?.sliderDisabled === true,
        `an unavailable entity disables the slider (${offline?.sliderDisabled})`,
      );
      // The stock row shows an em dash for an entity with no usable state.
      expect(
        offline?.state?.[0] === "—",
        `an unavailable entity reads as the stock row does (${offline?.state?.[0]}, expected —)`,
      );
      expect(
        offline?.state?.[1] === "70",
        `its available partner still shows its own value (${offline?.state?.[1]})`,
      );

      // number is the modern equivalent of input_number and takes the same
      // set_value call.
      const numberRow = byName["number domain"];
      expect(
        numberRow?.minValue === 30 && numberRow?.maxValue === 70,
        `a number entity pair drives the slider (${numberRow?.minValue}/${numberRow?.maxValue})`,
      );

      // warn_inverted: false opts out: no icon, values presented in order.
      const quiet = byName["Inverted (warning off)"];
      expect(
        quiet?.warningIcon === null,
        `warn_inverted: false hides the icon (${quiet?.warningIcon})`,
      );
      expect(
        quiet?.state?.[0] === "18.0 °C" && quiet?.state?.[1] === "24.0 °C",
        `warn_inverted: false presents the pair in order (${quiet?.state?.join(" / ")})`,
      );

      const equal = byEntity.equal_low;
      expect(
        equal?.minValue === 20 && equal?.maxValue === 20,
        `equal values render both handles at the same point (${equal?.minValue}/${equal?.maxValue})`,
      );
      // Themes that put a gap either side of the active track have nothing to
      // set it against when the handles coincide, and paint stray slivers.
      expect(
        equal?.collapsed === true && byEntity.lower_temp?.collapsed === false,
        `coincident handles mark the slider collapsed (${equal?.collapsed}, apart: ${byEntity.lower_temp?.collapsed})`,
      );

      // step: 1, so this one should carry no decimals at all.
      const whole = byEntity.whole_low;
      expect(
        whole?.state?.[0] === "20 %" && whole?.state?.[1] === "80 %",
        `whole-number step drops the decimals (${whole?.state?.join(" / ")})`,
      );

      // The stock row gives its slider 1px 8px gutters; without them our track
      // runs into the value readout and misaligns with the rows around it.
      const [ourMargin, stockMargin] = await Promise.all([
        row.evaluate(
          (el) => getComputedStyle(el.shadowRoot.querySelector("ha-slider")).margin,
        ),
        stockRow.evaluate(
          (el) => getComputedStyle(el.shadowRoot.querySelector("ha-slider")).margin,
        ),
      ]);
      expect(
        ourMargin === stockMargin,
        `slider has the same gutters as the stock row (${ourMargin} vs ${stockMargin})`,
      );

      // Drag the lower handle far past the upper one: ha-slider should clamp
      // rather than let them cross, so the card can never write an inverted pair.
      const thumbBox = await row.evaluate((el) => {
        const thumb = el.shadowRoot
          ?.querySelector("ha-slider")
          ?.shadowRoot?.querySelector("#thumb-min");
        const r = thumb?.getBoundingClientRect();
        return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
      });
      const trackBox = await row.evaluate((el) => {
        const track = el.shadowRoot
          ?.querySelector("ha-slider")
          ?.shadowRoot?.querySelector("#track");
        const r = track?.getBoundingClientRect();
        return r ? { right: r.right } : null;
      });
      if (thumbBox && trackBox) {
        await page.mouse.move(thumbBox.x, thumbBox.y);
        await page.mouse.down();
        await page.mouse.move(trackBox.right + 40, thumbBox.y, { steps: 12 });
        await page.mouse.up();
        await page.waitForTimeout(750);

        const dragged = await row.evaluate((el) => {
          const slider = el.shadowRoot?.querySelector("ha-slider");
          return { minValue: slider?.minValue, maxValue: slider?.maxValue };
        });
        console.log(`after dragging lower past upper: ${JSON.stringify(dragged)}`);
        expect(
          dragged.minValue <= dragged.maxValue,
          `handles cannot cross when dragged (${dragged.minValue} <= ${dragged.maxValue})`,
        );
        // The upper handle started at 24 and must not have been pushed along.
        expect(
          dragged.maxValue === 24,
          `dragging the lower handle does not push the upper one (upper=${dragged.maxValue}, expected 24)`,
        );
        expect(
          dragged.minValue === 24,
          `dragged handle stops at the other one (lower=${dragged.minValue}, expected 24)`,
        );

        const states = await (
          await fetch(`${HA_URL}/api/states/input_number.lower_temp`, {
            headers: { Authorization: `Bearer ${token}` },
          })
        ).json();
        const upperState = await (
          await fetch(`${HA_URL}/api/states/input_number.upper_temp`, {
            headers: { Authorization: `Bearer ${token}` },
          })
        ).json();
        console.log(
          `entities after drag: lower=${states.state} upper=${upperState.state}`,
        );
        expect(
          parseFloat(states.state) <= parseFloat(upperState.state),
          `drag writes the pair in order (lower=${states.state} upper=${upperState.state})`,
        );

        // Dragging a handle should raise that handle's value popup, as the stock
      // row does, and leave the other handle's alone.
      const popupState = () =>
        row.evaluate((el) =>
          [
            ...(el.shadowRoot
              ?.querySelector("ha-slider")
              ?.shadowRoot?.querySelectorAll("wa-tooltip") ?? []),
          ].map((t) => ({
            id: t.id,
            open: t.hasAttribute("open") || t.open === true,
            text: (t.textContent ?? "").trim(),
          })),
        );
      const maxThumb = await row.evaluate((el) => {
        const node = el.shadowRoot
          ?.querySelector("ha-slider")
          ?.shadowRoot?.querySelector("#thumb-max");
        const r = node?.getBoundingClientRect();
        return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
      });
      if (maxThumb) {
        await page.mouse.move(maxThumb.x, maxThumb.y);
        await page.mouse.down();
        await page.mouse.move(maxThumb.x + 20, maxThumb.y, { steps: 6 });
        await page.waitForTimeout(400);
        const during = await popupState();
        await page.mouse.up();
        await page.waitForTimeout(400);
        const after = await popupState();
        console.log(`popup while dragging: ${JSON.stringify(during)}`);

        // The popup should be styled like the stock row's, which under a theme
        // that restyles tooltips means the theme's own treatment rather than
        // Home Assistant's default.
        const readPopup = (el, id) => {
          const tip = el.shadowRoot
            ?.querySelector("ha-slider")
            ?.shadowRoot?.querySelector(`#${id}`);
          const part = tip?.shadowRoot?.querySelector('[part~="body"]');
          if (!part) return null;
          const style = getComputedStyle(part);
          return {
            background: style.backgroundColor,
            color: style.color,
            radius: style.borderRadius,
          };
        };
        const popupStyle = {
          ours: await row.evaluate(
            (el, src) => eval(src)(el, "tooltip-thumb-max"),
            readPopup.toString(),
          ),
          stock: await stockRow.evaluate(
            (el, src) => eval(src)(el, "tooltip"),
            readPopup.toString(),
          ),
        };
        console.log(`popup style: ${JSON.stringify(popupStyle)}`);

        const dragged = during.find((t) => t.id === "tooltip-thumb-max");
        const idle = during.find((t) => t.id === "tooltip-thumb-min");
        expect(
          dragged?.open === true,
          `dragging a handle opens its value popup (${dragged?.open})`,
        );
        expect(
          !!dragged?.text && dragged.text !== idle?.text,
          `the popup follows the handle being dragged (${dragged?.text} vs ${idle?.text})`,
        );
        expect(
          idle?.open === false,
          `the other handle's popup stays closed (${idle?.open})`,
        );
        expect(
          after.every((t) => !t.open),
          "the popup closes when the drag ends",
        );
      }

      // The mismatched pair spans 15-30 because the ranges are merged, so the
        // lower handle can reach values its own entity (max 20) would reject.
        // Dragging it to the far right must write 20, not what the slider shows.
        // By configured name rather than position, so inserting a row above it
        // cannot silently point this at something else.
        const narrowIndex = await page
          .locator("range-entity-row")
          .evaluateAll((rows) =>
            rows.findIndex((el) => el.config?.name === "Mismatched ranges"),
          );
        const narrowRow = page.locator("range-entity-row").nth(narrowIndex);
        const narrowThumb = await narrowRow
          .evaluate((el) => {
            const thumb = el.shadowRoot
              ?.querySelector("ha-slider")
              ?.shadowRoot?.querySelector("#thumb-min");
            const r = thumb?.getBoundingClientRect();
            return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
          })
          .catch(() => null);
        if (narrowThumb) {
          await page.mouse.move(narrowThumb.x, narrowThumb.y);
          await page.mouse.down();
          await page.mouse.move(trackBox.right + 60, narrowThumb.y, { steps: 12 });
          await page.mouse.up();
          await page.waitForTimeout(750);
          const narrow = await (
            await fetch(`${HA_URL}/api/states/input_number.narrow_low`, {
              headers: { Authorization: `Bearer ${token}` },
            })
          ).json();
          console.log(`narrow_low after dragging past its max: ${narrow.state}`);
          expect(
            parseFloat(narrow.state) === 20,
            `a handle dragged past its own entity's max writes that max (${narrow.state}, expected 20)`,
          );
        }

        // Put every dragged entity back, so the captures below show the
        // documented values rather than wherever the tests left the handles.
        await restoreValues();
        await page.waitForTimeout(500);
      }

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

    // One capture per colour scheme covering everything the dashboard holds:
    // the custom row above the stock rows it is modelled on, and the edge cases
    // beside them. Four separate element shots said the same thing in pieces.
    const overview = `${OUT_DIR}/overview-${HA_VERSION}-${colorScheme}.png`;
    setPhase(`overview capture (${colorScheme})`);
    await captureOverview(page, overview);
    console.log(`saved ${overview}`);

    // The visual editor. Mounted inside Home Assistant's own element tree, not
    // on document.body: an ha-entity-picker collapses to nothing outside it,
    // since it takes its layout from the styling Home Assistant sets at the
    // root, which is why the first attempt at this capture had blank rows where
    // the two pickers should be.
    setPhase(`editor mount (${colorScheme})`);
    await page.evaluate(async () => {
      const root = document.querySelector("home-assistant").shadowRoot;
      const host = document.createElement("div");
      host.id = "editor-capture";
      host.style.cssText = [
        "position: fixed",
        "inset: 24px auto auto 24px",
        "width: 420px",
        "padding: 16px",
        "border-radius: 12px",
        "z-index: 9999",
        "background: var(--card-background-color, #fff)",
        "color: var(--primary-text-color, #000)",
        "box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25)",
      ].join(";");
      const element = customElements.get("range-entity-row").getConfigElement();
      element.hass = document.querySelector("home-assistant").hass;
      element.setConfig({
        type: "custom:range-entity-row",
        entity: "input_number.lower_temp",
        range_entity: "input_number.upper_temp",
        name: "Temperature Range",
        icon: "mdi:thermometer",
      });
      host.append(element);
      root.append(host);
      await element.updateComplete;
      await new Promise((resolve) => setTimeout(resolve, 1200));
    });
    const editorShot = `${OUT_DIR}/editor-${HA_VERSION}-${colorScheme}.png`;
    await page.locator("#editor-capture").screenshot({ path: editorShot });
    console.log(`saved ${editorShot}`);
    await page.evaluate(() => {
      const root = document.querySelector("home-assistant").shadowRoot;
      root.querySelector("#editor-capture")?.remove();
    });


    await context.close();
  }

  // Each capture holds a drag on the top row; if that did not reset cleanly,
  // every capture would start from where the last one left off.
  const dragState = await Promise.all(
    ["input_number.drag_low", "input_number.drag_high"].map(async (id) =>
      parseFloat(
        (
          await (
            await fetch(`${HA_URL}/api/states/${id}`, {
              headers: { Authorization: `Bearer ${token}` },
            })
          ).json()
        ).state,
      ),
    ),
  );
  expect(
    dragState[0] === 18 && dragState[1] === 24,
    `the captures leave the drag row as they found it (${dragState.join("/")})`,
  );

  // Nothing the run does to a handle should outlive it.
  const drifted = [];
  for (const [entity, expected] of Object.entries(DOCUMENTED_VALUES)) {
    const state = await (
      await fetch(`${HA_URL}/api/states/${entity}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json();
    if (parseFloat(state.state) !== expected) {
      drifted.push(`${entity}=${state.state} (expected ${expected})`);
    }
  }
  expect(
    drifted.length === 0,
    `dragging for the tests and captures leaves every value as documented${drifted.length ? `: ${drifted.join(", ")}` : ""}`,
  );

  if (SWEEP_THEMES) {
    const installed = (await getThemes(token)).filter(
      ({ name }) => !EXCLUDED_THEMES.test(name),
    );

    let themes;
    if (THEME_FILTER) {
      const wanted = THEME_FILTER.split(",").map((s) => s.trim().toLowerCase());
      themes = installed.filter(({ name }) =>
        wanted.some((w) => name.toLowerCase().includes(w)),
      );
    } else if (ALL_THEMES) {
      themes = installed;
    } else {
      const available = new Map(
        installed.map((theme) => [theme.name.toLowerCase(), theme]),
      );
      themes = CURATED_THEMES.map((name) =>
        available.get(name.toLowerCase()),
      ).filter(Boolean);
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
    const skipped = [];
    const appearances = new Map();
    let cardModChecked = false;

    // One capture stands for both modes: drop the now-misleading suffix and
    // relabel the row.
    const markStatic = (theme) => {
      const slug = theme.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      let renamed = false;
      for (const extra of ["", "-nopatch"]) {
        const from = `${themeDir}/${slug}-light${extra}.png`;
        const to = `${themeDir}/${slug}${extra}.png`;
        // Do not claim a name another theme already holds: "Frosted Glass Dark"
        // would otherwise take the file "Frosted Glass" wrote for its dark mode.
        if (existsSync(from) && !existsSync(to)) {
          renameSync(from, to);
          if (!extra) renamed = true;
        }
      }
      const row = results.find((r) => r.theme === theme);
      if (row) {
        row.colorScheme = "static";
        // Only follow the rename that actually happened. Checking the target
        // exists is not the same question: it may be another theme's capture,
        // which had this row pointing at someone else's screenshot.
        if (renamed) row.file = `${slug}.png`;
      }
    };

    for (const colorScheme of ["light", "dark"]) {
      const context = await browser.newContext({
        viewport: { width: 1400, height: 1200 },
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

      for (const { name: theme, hasModes } of themes) {
        // A theme that declares no light/dark modes of its own cannot render
        // differently, so skip the second pass without even loading it.
        if (colorScheme === "dark" && !hasModes) {
          skipped.push(theme);
          markStatic(theme);
          continue;
        }
        await setTheme(token, theme);
        await page.goto(`${HA_URL}/lovelace/0`, {
          waitUntil: "domcontentloaded",
        });

        const row = page.locator("range-entity-row").first();
        try {
          await row.waitFor({ state: "attached", timeout: 30_000 });
          await page.waitForTimeout(750);
        } catch {
          results.push({ theme, colorScheme, error: "row never appeared" });
          continue;
        }

        // card-mod is a resource, not a theme: several packs put their styles
        // behind card-mod-theme keys, which silently do nothing without it.
        if (!cardModChecked) {
          cardModChecked = true;
          const registered = await page.evaluate(
            () => !!customElements.get("card-mod") && !!customElements.get("mod-card"),
          );
          expect(registered, "card-mod is loaded for the themes that need it");
        }

        // Themes can declare modes whose values are identical; compare how the
        // theme actually resolved before taking a second screenshot.
        const appearance = await row.evaluate(APPEARANCE_PROBE);
        if (colorScheme === "light") {
          appearances.set(theme, appearance);
        } else if (appearances.get(theme) === appearance) {
          skipped.push(theme);
          markStatic(theme);
          continue;
        }

        const handles = await row.evaluate(HANDLE_PROBE);

        // material-you narrows the handle and tightens the gap while a value
        // popup is open. Its own rules key off #tooltip, which a range slider
        // does not have, so the card mirrors them per handle — check they fire.
        let dragShape = null;
        if (/material you/i.test(theme)) {
          const thumb = await row.evaluate((el) => {
            const node = el.shadowRoot
              ?.querySelector("ha-slider")
              ?.shadowRoot?.querySelector("#thumb-max");
            const r = node?.getBoundingClientRect();
            return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
          });
          if (thumb) {
            const measure = () =>
              row.evaluate((el) => {
                const shadow = el.shadowRoot
                  ?.querySelector("ha-slider")?.shadowRoot;
                const t = shadow?.querySelector("#thumb-max");
                const i = shadow?.querySelector("#indicator");
                const r = t?.getBoundingClientRect();
                return {
                  thumbScale: t ? getComputedStyle(t).scale : null,
                  barScale: t ? getComputedStyle(t, "::before").scale : null,
                  indicatorMargin: i
                    ? getComputedStyle(i).marginInlineEnd
                    : null,
                  cornerInset: i
                    ? getComputedStyle(i, "::after").insetInlineEnd
                    : null,
                  thumbWidth: r ? r.width.toFixed(1) : null,
                };
              });
            const idle = await measure();
            await page.mouse.move(thumb.x, thumb.y);
            await page.mouse.down();
            await page.mouse.move(thumb.x + 12, thumb.y, { steps: 5 });
            await page.waitForTimeout(400);
            const active = await measure();
            await page.mouse.up();
            await page.waitForTimeout(300);
            dragShape = { idle, active };
            console.log(`\ndrag shape: ${JSON.stringify(dragShape)}`);
          }
        }

        const slug = theme.toLowerCase().replace(/[^a-z0-9]+/g, "-");
        const suffix = `-${colorScheme}`;
        results.push({
          theme,
          colorScheme,
          file: `${slug}${suffix}.png`,
          dragShape,
          ...handles,
        });
        await captureOverview(page, `${themeDir}/${slug}${suffix}.png`);

        if (process.env.DIAGNOSE_ZOOM === "1") {
          // A dedicated high-DPI context, so the crops are big enough to judge
          // corner radii rather than anti-aliasing.
          const zoomContext = await browser.newContext({
            viewport: { width: 1400, height: 1200 },
            colorScheme,
            deviceScaleFactor: 8,
          });
          await zoomContext.addInitScript(
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
          const zoomPage = await zoomContext.newPage();
          await zoomPage.goto(`${HA_URL}/lovelace/0`, {
            waitUntil: "domcontentloaded",
          });
          await zoomPage.locator("range-entity-row").first().waitFor({
            state: "attached",
            timeout: 30_000,
          });
          await zoomPage.waitForTimeout(1000);

          const BOX_OF = (el, selector) => {
            const node = el.shadowRoot
              ?.querySelector("ha-slider")
              ?.shadowRoot?.querySelector(selector);
            if (!node) return null;
            const r = node.getBoundingClientRect();
            return {
              x: r.x + r.width / 2 - 20,
              y: r.y + r.height / 2 - 10,
              width: 40,
              height: 20,
            };
          };
          const zoomRow = zoomPage.locator("range-entity-row").first();
          const zoomStock = zoomPage
            .locator("hui-input-number-entity-row")
            .first();
          const boxes = {
            "ours-min": await zoomRow.evaluate(
              (el, src) => eval(src)(el, "#thumb-min"),
              BOX_OF.toString(),
            ),
            "ours-max": await zoomRow.evaluate(
              (el, src) => eval(src)(el, "#thumb-max"),
              BOX_OF.toString(),
            ),
            stock: await zoomStock.evaluate(
              (el, src) => eval(src)(el, "#thumb"),
              BOX_OF.toString(),
            ),
          };
          for (const [label, clip] of Object.entries(boxes)) {
            if (!clip) continue;
            await zoomPage.screenshot({
              path: `${themeDir}/zoom-${label}-${colorScheme}.png`,
              clip,
            });
          }

          // The same crops with the handle held, which is the state a theme
          // animates and the only way to compare our drag treatment with the
          // stock row's rather than guess at it.
          for (const [label, locator, thumbSel] of [
            ["ours-max", zoomRow, "#thumb-max"],
            ["stock", zoomStock, "#thumb"],
          ]) {
            const clip = boxes[label];
            const at = await locator.evaluate((el, sel) => {
              const node = el.shadowRoot
                ?.querySelector("ha-slider")
                ?.shadowRoot?.querySelector(sel);
              const r = node?.getBoundingClientRect();
              return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
            }, thumbSel);
            if (!clip || !at) continue;
            await zoomPage.mouse.move(at.x, at.y);
            await zoomPage.mouse.down();
            // Barely move: enough to open the popup and trigger the theme's
            // active state without shifting the handle out of the crop.
            await zoomPage.mouse.move(at.x + 1, at.y, { steps: 2 });
            await zoomPage.waitForTimeout(500);
            await zoomPage.screenshot({
              path: `${themeDir}/zoom-${label}-${colorScheme}-held.png`,
              clip,
            });
            await zoomPage.mouse.move(at.x, at.y, { steps: 2 });
            await zoomPage.mouse.up();
            await zoomPage.waitForTimeout(200);
          }
          await restoreValues();

          await zoomContext.close();
        }

        // Optional side-by-side: what the row looks like with the card's whole
        // shadow-DOM patch detached, i.e. Home Assistant's own range slider.
        if (process.env.DIAGNOSE_PATCH === "1") {
          await row.evaluate((el) => {
            const shadow = el.shadowRoot?.querySelector("ha-slider")?.shadowRoot;
            shadow?.querySelector("#range-slider-fix")?.remove();
          });
          await page.waitForTimeout(250);
          await page.locator("hui-entities-card").first().screenshot({
            path: `${themeDir}/${slug}-${colorScheme}-nopatch.png`,
          });
        }
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

    // Both ends of the range indicator face a handle, so neither should be
    // square against it. The base component leaves the far end at 8px.
    for (const result of results.filter((r) => /material you/i.test(r.theme))) {
      expect(
        result.indicatorRadius === "2px",
        `material-you indicator is rounded against both handles in ${result.colorScheme} (${result.indicatorRadius})`,
      );
      // The handle should visibly react to being dragged, as the stock row does.
      if (result.dragShape) {
        const { idle, active } = result.dragShape;
        expect(
          active.thumbScale !== idle.thumbScale ||
            active.barScale !== idle.barScale,
          `material-you narrows the handle while dragging in ${result.colorScheme} (${idle.thumbScale}/${idle.barScale} -> ${active.thumbScale}/${active.barScale})`,
        );
        // The gap animates, so a reading taken mid-transition lands near 4px
        // rather than on it.
        expect(
          Math.abs(parseFloat(active.indicatorMargin) - 4) < 0.5,
          `and tightens the gap to it in ${result.colorScheme} (${active.indicatorMargin})`,
        );
        // The inactive side has to come in with it, or the handle sits in a gap
        // that is tight on one side and wide on the other. The theme's own rule
        // for this loses to the base one without !important.
        expect(
          Math.abs(parseFloat(active.cornerInset) + 14) < 0.5,
          `and the inactive corner comes in with it in ${result.colorScheme} (${active.cornerInset}, idle ${idle.cornerInset})`,
        );
      }

      // Without the gap the thumb's negative rect covers that rounded end.
      expect(
        (result.indicatorMargin ?? "")
          .split(" ")
          .every((value) => Math.abs(parseFloat(value) - 6) < 0.5),
        `material-you indicator keeps a gap beside both handles in ${result.colorScheme} (${result.indicatorMargin})`,
      );
    }

    // Filenames alone are ambiguous — "graphite-light.png" is the Graphite
    // Light theme, not Graphite in light mode — so record what each file holds.
    writeFileSync(
      `${themeDir}/manifest.json`,
      `${JSON.stringify(
        results
          .filter((r) => r.file && !r.error)
          .map(({ file, theme, colorScheme }) => ({ file, theme, colorScheme })),
        null,
        2,
      )}\n`,
    );

    const claimed = new Map();
    for (const row of results.filter((r) => r.file && !r.error)) {
      claimed.set(row.file, [...(claimed.get(row.file) ?? []), row.theme]);
    }
    const shared = [...claimed.entries()].filter(([, owners]) => owners.length > 1);
    expect(
      shared.length === 0,
      `each capture belongs to one theme${shared.length ? `: ${shared.map(([f, o]) => `${f} claimed by ${o.join(" and ")}`).join("; ")}` : ""}`,
    );

    if (skipped.length) {
      console.log(
        `\n${skipped.length} theme(s) captured once because light and dark resolve identically: ${skipped.join(", ")}`,
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

if (knownNoise) {
  console.log(
    `\nignored ${knownNoise} known Home Assistant error(s) — see KNOWN_NOISE and KNOWN_BOOT_NOISE`,
  );
}

for (const warning of warnings) console.warn(`warning: ${warning}`);

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed:`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log("\nall render checks passed");
