const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const sdk = execFileSync("curl", [
  "-fsS",
  "--max-time",
  "30",
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js",
]);
const server = http.createServer((req, res) => {
  const name = req.url === "/" ? "index.html" : req.url.slice(1);
  if (
    ![
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
    ].includes(name)
  ) {
    res.writeHead(404).end();
    return;
  }
  const types = {
    ".html": "text/html",
    ".css": "text/css",
    ".js": "application/javascript",
    ".webmanifest": "application/manifest+json",
    ".png": "image/png",
  };
  res.setHeader("Content-Type", types[path.extname(name)]);
  res.end(fs.readFileSync(path.join(root, name)));
});
(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  try {
    const page = await browser.newPage({
      serviceWorkers: "block",
      viewport: { width: 390, height: 844 },
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("https://cdn.jsdelivr.net/**", (route) =>
      route.fulfill({ contentType: "application/javascript", body: sdk }),
    );
    let rows = [];
    let failRead = false;
    let failInsert = false;
    let posts = 0;
    const queryUrls = [];
    const postUrls = [];
    await page.route("https://*.supabase.co/rest/v1/**", async (route) => {
      const request = route.request();
      if (request.method() === "POST") {
        posts++;
        postUrls.push(request.url());
        if (new URL(request.url()).pathname !== "/rest/v1/repair_requests") {
          return route.fulfill({
            status: 404,
            json: {
              code: "PGRST205",
              message: "Could not find the table in the schema cache",
            },
          });
        }
        const body = request.postDataJSON();
        assert.deepEqual(
          Object.keys(body).sort(),
          [
            "reporter_name",
            "location",
            "category",
            "description",
            "urgency",
          ].sort(),
        );
        assert.equal(body.reporter_name, "示範同事");
        await new Promise((resolve) => setTimeout(resolve, 150));
        if (failInsert)
          return route.fulfill({
            status: 403,
            json: { message: "permission denied", code: "42501" },
          });
        rows = [
          {
            ...body,
            id: "demo",
            status: "待處理",
            created_at: "2026-11-11T07:00:00Z",
          },
          ...rows,
        ];
        return route.fulfill({ status: 201, body: "" });
      }
      queryUrls.push(request.url());
      if (failRead)
        return route.fulfill({
          status: 503,
          json: { message: "service unavailable" },
        });
      return route.fulfill({ json: rows.slice(0, 20) });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.getByText("目前還沒有報修紀錄", { exact: false }).waitFor();
    assert.equal(
      await page
        .locator("#category option:not([disabled])")
        .allTextContents()
        .then((v) => v.join(",")),
      "設備,網路,環境,其他",
    );
    assert.deepEqual(
      await page
        .locator("[name=urgency]")
        .evaluateAll((inputs) => inputs.map((i) => i.value)),
      ["低", "中", "高"],
    );
    await page.locator("#submit-button").click();
    assert.equal(posts, 0, "required fields prevent insert");
    async function fill() {
      await page.locator("#reporter-name").fill(" 示範同事 ");
      await page.locator("#location").fill("示範辦公室");
      await page.locator("#category").selectOption("網路");
      await page
        .locator("#description")
        .fill('<img src=x onerror="window.injected=true">\n網路無法連線');
      await page.locator("[name=urgency][value=高]").check();
    }
    await fill();
    await page.locator("#reporter-name").fill("   ");
    await page.locator("#submit-button").click();
    await page.getByText("請填妥所有欄位", { exact: false }).waitFor();
    assert.equal(posts, 0);
    await fill();
    await page.locator("#submit-button").click();
    assert.equal(await page.locator("#submit-button").isDisabled(), true);
    await page.waitForFunction(() =>
      ["success", "error"].includes(
        document.querySelector("#form-message").dataset.kind,
      ),
    );
    assert.equal(
      new URL(postUrls[0]).pathname,
      "/rest/v1/repair_requests",
      "insert must target the existing plural table",
    );
    await page.locator("#form-message[data-kind=success]").waitFor();
    await page.locator(".request-card").waitFor();
    assert.equal(posts, 1);
    const filters = page.getByRole("group", { name: "依緊急程度篩選" });
    assert.equal(
      await filters
        .getByRole("button", { name: "全部", exact: true })
        .getAttribute("aria-pressed"),
      "true",
    );
    const readsBeforeFilter = queryUrls.length;
    const postsBeforeFilter = posts;
    await filters.getByRole("button", { name: "低", exact: true }).click();
    assert.equal(await page.locator(".request-card").count(), 0);
    await page.getByText("已載入的清單中沒有緊急程度「低」的報修。").waitFor();
    await filters.getByRole("button", { name: "高", exact: true }).click();
    assert.equal(await page.locator(".request-card").count(), 1);
    assert.equal(
      await filters
        .getByRole("button", { name: "高", exact: true })
        .getAttribute("aria-pressed"),
      "true",
    );
    assert.equal(await filters.locator('[aria-pressed="true"]').count(), 1);
    assert.equal(
      await page
        .locator('.badge[data-urgency="高"]')
        .evaluate((el) => getComputedStyle(el).color),
      "rgb(185, 28, 28)",
    );
    await filters.getByRole("button", { name: "全部", exact: true }).click();
    assert.equal(
      queryUrls.length,
      readsBeforeFilter,
      "filtering must not read the database",
    );
    assert.equal(
      posts,
      postsBeforeFilter,
      "filtering must not write the database",
    );
    assert.equal(await page.locator("#reporter-name").inputValue(), "");
    assert.equal(await page.locator(".request-card img").count(), 0);
    assert.equal(await page.evaluate(() => window.injected), undefined);
    assert.match(
      await page.locator(".request-card time").textContent(),
      /下午3:00|15:00/,
    );
    assert.ok(
      queryUrls.every(
        (url) =>
          new URL(url).searchParams.get("order") === "created_at.desc" &&
          new URL(url).searchParams.get("limit") === "20",
      ),
    );
    failInsert = true;
    await fill();
    await page.locator("#submit-button").click();
    await page.locator("#form-message[data-kind=error]").waitFor();
    assert.equal(
      (await page.locator("#reporter-name").inputValue()).trim(),
      "示範同事",
    );
    failRead = true;
    await page.locator("#refresh-button").click();
    await page.locator("#list-message[data-kind=error]").waitFor();
    assert.equal(await page.locator(".request-card").count(), 1);
    failRead = false;
    rows = Array.from({ length: 25 }, (_, i) => ({
      id: String(i),
      reporter_name: "示範同事",
      location: `示範地點 ${i}`,
      category: "設備",
      urgency: ["高", "中", "低"][i % 3],
      status: "待處理",
      description: "示範問題\n待確認",
      created_at: new Date(Date.UTC(2026, 10, 11, 8, 0, -i)).toISOString(),
    }));
    await page.locator("#refresh-button").click();
    await page.waitForFunction(
      () => document.querySelectorAll(".request-card").length === 20,
    );
    assert.match(
      await page.locator(".request-card").first().textContent(),
      /示範地點 0/,
    );
    assert.match(
      await page.locator(".request-card").last().textContent(),
      /示範地點 19/,
    );
    const readsBeforeMixedFilter = queryUrls.length;
    const allTitles = await page.locator(".request-card h3").allTextContents();
    for (const urgency of ["高", "中", "低"]) {
      await filters.getByRole("button", { name: urgency, exact: true }).click();
      assert.equal(
        await page.locator(".request-card").count(),
        rows.slice(0, 20).filter((row) => row.urgency === urgency).length,
      );
      assert.ok(
        (
          await page.locator(".request-card [data-urgency]").allTextContents()
        ).every((text) => text === `緊急程度：${urgency}`),
      );
    }
    await filters.getByRole("button", { name: "全部", exact: true }).click();
    assert.deepEqual(
      await page.locator(".request-card h3").allTextContents(),
      allTitles,
    );
    assert.equal(queryUrls.length, readsBeforeMixedFilter);
    await filters.getByRole("button", { name: "高", exact: true }).click();
    await page.locator("#refresh-button").click();
    await page.waitForFunction(
      () =>
        document.querySelector("#request-list").getAttribute("aria-busy") ===
        "false",
    );
    assert.equal(
      await filters
        .getByRole("button", { name: "高", exact: true })
        .getAttribute("aria-pressed"),
      "true",
    );
    assert.equal(await page.locator(".request-card").count(), 7);
    await filters.getByRole("button", { name: "全部", exact: true }).click();
    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
        `no horizontal overflow at ${width}px`,
      );
    }
    rows = rows.slice(0, 2);
    await page.reload();
    await page.waitForFunction(
      () => document.querySelectorAll(".request-card").length === 2,
    );
    assert.equal(
      await filters
        .getByRole("button", { name: "全部", exact: true })
        .getAttribute("aria-pressed"),
      "true",
    );
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: path.join(root, "docs/mobile.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.screenshot({
      path: path.join(root, "docs/desktop.png"),
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    // Missing CDN: the page must explain the failure and disable submitting.
    await page.route("https://cdn.jsdelivr.net/**", (route) => route.abort());
    await page.reload();
    await page.locator("#form-message[data-kind=error]").waitFor();
    assert.equal(await page.locator("#submit-button").isDisabled(), true);
    console.log(
      "PASS: required/whitespace validation, options, five-field insert, defaults, duplicate prevention, refresh, 20 newest records, errors, XSS, mobile layout, missing CDN. API responses mocked; live database not tested.",
    );
  } finally {
    await browser.close();
    server.close();
  }
})().catch((error) => {
  console.error(error);
  server.close();
  process.exitCode = 1;
});
