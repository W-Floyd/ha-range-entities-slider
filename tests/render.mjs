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

  const indicator = sliderShadow.querySelector("#indicator");
  const indicatorRadius = indicator
    ? getComputedStyle(indicator).borderRadius
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

  return { thumb: true, fix: !!patch, indicatorRadius, ...withFix, withoutFix };
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

      // warn_inverted: false opts out: no icon, values presented in order.
      const quiet = byName["Inverted (warning disabled)"];
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

        // Put them back so the screenshots below are the documented values.
        await fetch(`${HA_URL}/api/services/input_number/set_value`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            entity_id: "input_number.lower_temp",
            value: 18,
          }),
        });
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

    for (const [name, locator] of [
      ["row", row],
      ["stock-row", stockRow],
      ["card", page.locator("hui-entities-card").first()],
      ["edge-cases", page.locator("hui-entities-card").nth(1)],
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

        const row = page.locator("range-entity-row").first();
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
          .first()
          .screenshot({ path: `${themeDir}/${slug}-${colorScheme}.png` });

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
