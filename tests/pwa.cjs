const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const cdnUrl =
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js";
// Serve the real SDK locally so worker tests don't depend on browser proxy setup.
const sdk = execFileSync("curl", ["-fsS", "--max-time", "30", cdnUrl]);
let origin;
let version = "v1";
let missingAsset = false;
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  if (pathname === "/fixture-sdk.js") {
    res.setHeader("Content-Type", "application/javascript");
    return res.end(sdk);
  }
  if (pathname === "/unrelated.html") return res.end("unrelated");
  if (!pathname.startsWith("/gogoparis/")) return res.writeHead(404).end();
  const name = pathname.slice("/gogoparis/".length) || "index.html";
  const allowed = [
    "index.html",
    "style.css",
    "app.js",
    "config.js",
    "pwa.js",
    "sw.js",
    "manifest.webmanifest",
    "icons/icon-192.png",
    "icons/icon-512.png",
    "icons/icon-maskable-512.png",
    "icons/apple-touch-icon.png",
  ];
  if (!allowed.includes(name) || (missingAsset && name === "style.css"))
    return res.writeHead(404).end();
  const types = {
    ".html": "text/html",
    ".js": "application/javascript",
    ".css": "text/css",
    ".webmanifest": "application/manifest+json",
    ".png": "image/png",
  };
  res.setHeader("Content-Type", types[path.extname(name)]);
  res.setHeader("Cache-Control", "no-store");
  let content = fs.readFileSync(path.join(root, name));
  if (name === "index.html" || name === "sw.js") {
    content = content.toString().replaceAll(cdnUrl, `${origin}/fixture-sdk.js`);
    if (name === "sw.js")
      content = content.replace(
        'const VERSION = "v1";',
        `const VERSION = "${version}";`,
      );
  }
  res.end(content);
});
(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  const profile = fs.mkdtempSync(
    path.join(require("node:os").tmpdir(), "repair-pwa-test-"),
  );
  const context = await chromium.launchPersistentContext(profile, {
    viewport: { width: 390, height: 844 },
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  try {
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    let writes = 0;
    await context.route("https://*.supabase.co/rest/v1/**", (route) => {
      if (route.request().method() !== "GET") writes++;
      return route.fulfill({
        json: [
          {
            id: "demo",
            reporter_name: "示範同事",
            location: "示範地點",
            category: "設備",
            description: "測試資料不應快取",
            urgency: "高",
            status: "待處理",
            created_at: "2026-01-01T00:00:00Z",
          },
        ],
      });
    });
    await page.goto(`${origin}/gogoparis/`);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await page.locator(".request-card").waitFor();
    const manifest = await page.evaluate(async () => {
      const link = document.querySelector("link[rel=manifest]");
      return {
        url: link.href,
        data: await fetch(link.href).then((r) => r.json()),
      };
    });
    assert.equal(
      new URL(manifest.data.start_url, manifest.url).pathname,
      "/gogoparis/",
    );
    assert.equal(
      new URL(manifest.data.scope, manifest.url).pathname,
      "/gogoparis/",
    );
    assert.equal(manifest.data.display, "standalone");
    assert.equal(manifest.data.id, "./");
    for (const icon of manifest.data.icons) {
      const actual = await page.evaluate(async (url) => {
        const img = new Image();
        img.src = url;
        await img.decode();
        return `${img.naturalWidth}x${img.naturalHeight}`;
      }, new URL(icon.src, manifest.url).href);
      assert.equal(actual, icon.sizes);
    }
    const cdp = await context.newCDPSession(page);
    const appManifest = await cdp.send("Page.getAppManifest");
    assert.deepEqual(appManifest.errors, []);
    const installability = await cdp.send("Page.getInstallabilityErrors");
    assert.deepEqual(installability.installabilityErrors, []);
    const cacheUrls = await page.evaluate(async () => {
      const urls = [];
      for (const key of await caches.keys())
        for (const r of await (await caches.open(key)).keys()) urls.push(r.url);
      return urls;
    });
    assert.ok(cacheUrls.includes(`${origin}/fixture-sdk.js`));
    assert.ok(
      cacheUrls.every(
        (url) =>
          url.startsWith(`${origin}/gogoparis/`) ||
          url === `${origin}/fixture-sdk.js`,
      ),
    );
    assert.ok(
      !cacheUrls.some(
        (url) => url.includes("supabase.co") || url.includes("/文件/"),
      ),
    );
    await context.setOffline(true);
    await page.waitForFunction(() => !navigator.onLine);
    await page.reload();
    await page
      .getByText("目前離線：可開啟已快取的頁面", { exact: false })
      .waitFor();
    assert.equal(
      await page.locator(".request-card").count(),
      0,
      "records are not persisted offline",
    );
    assert.equal(
      await page.locator("#submit-button").isEnabled(),
      true,
      "SDK and local shell loaded offline",
    );
    await page.locator("#reporter-name").fill("離線示範");
    await page.locator("#location").fill("虛構地點");
    await page.locator("#category").selectOption("設備");
    await page.locator("#description").fill("未送出的內容");
    await page.locator("#submit-button").click();
    await page.getByText("目前離線，報修尚未送出", { exact: false }).waitFor();
    assert.equal(await page.locator("#reporter-name").inputValue(), "離線示範");
    assert.equal(writes, 0);
    await context.setOffline(false);
    await page.locator(".request-card").waitFor();
    assert.equal(writes, 0, "reconnection never auto-submits");
    await page.locator("#description").fill("更新前保留的內容");
    // An incomplete new shell must not replace v1.
    version = "v-broken";
    missingAsset = true;
    await page.evaluate(async () => {
      await (await navigator.serviceWorker.getRegistration()).update();
    });
    await page.waitForFunction(
      async () => !(await navigator.serviceWorker.getRegistration()).installing,
    );
    assert.equal(
      await page.evaluate(() => navigator.serviceWorker.controller.state),
      "activated",
    );
    assert.equal(
      await page.locator("#description").inputValue(),
      "更新前保留的內容",
    );
    // A complete update waits for user action without reloading the form.
    version = "v2";
    missingAsset = false;
    await page.evaluate(async () => {
      await (await navigator.serviceWorker.getRegistration()).update();
    });
    await page.locator("#update-button").waitFor();
    assert.equal(
      await page.locator("#description").inputValue(),
      "更新前保留的內容",
    );
    assert.ok(
      (await page.locator("#pwa-status").textContent()).includes("有新版本"),
    );
    await page.locator("#update-button").click();
    await page.waitForFunction(async () =>
      (await caches.keys()).some((key) => key.endsWith(":v2")),
    );
    await page.waitForFunction(
      () => document.querySelector("#description").value === "",
    );
    const keys = await page.evaluate(() => caches.keys());
    assert.equal(keys.filter((key) => key.startsWith("repair-pwa:")).length, 1);
    assert.ok(keys.some((key) => key.endsWith(":v2")));
    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.locator("summary").click();
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      await page.locator("summary").click();
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: path.join(root, "docs/mobile.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.screenshot({
      path: path.join(root, "docs/desktop.png"),
      fullPage: true,
    });
    await page.goto(`${origin}/unrelated.html`);
    assert.equal(
      await page.evaluate(() => navigator.serviceWorker.controller),
      null,
      "worker does not control sibling sites",
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS: subpath manifest/icons, real worker cache, offline reload, no record persistence or automatic writes, reconnect, failed install, explicit update and cache cleanup, mobile layout, scope isolation. SDK locally proxied; API mocked.",
    );
  } finally {
    await context.close();
    fs.rmSync(profile, { recursive: true, force: true });
    server.close();
  }
})().catch((error) => {
  console.error(error);
  server.close();
  process.exitCode = 1;
});
