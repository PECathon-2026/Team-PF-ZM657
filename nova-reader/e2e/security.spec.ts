// Security headers, CSP, privacy (no third-party requests) and safe API errors (Stage 9).
import { expect, test } from "@playwright/test";
import { loadFeed, mockApis, watchCspViolations } from "./fixtures";

test("pages send the security headers and do not advertise the framework", async ({ request }) => {
  for (const path of ["/", "/radar"]) {
    const response = await request.get(path);
    const headers = response.headers();
    expect(headers["content-security-policy"]).toContain("default-src 'self'");
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["content-security-policy"]).toContain("object-src 'none'");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["referrer-policy"]).toBe("no-referrer");
    expect(headers["permissions-policy"]).toContain("camera=()");
    expect(headers["strict-transport-security"]).toContain("max-age=");
    expect(headers["x-powered-by"]).toBeUndefined();
  }
});

test("the real API routes return safe JSON errors", async ({ request }) => {
  const blocked = await request.get(`/api/feed?url=${encodeURIComponent("http://169.254.169.254/latest/meta-data/")}`);
  expect(blocked.status()).toBe(400);
  expect(await blocked.json()).toMatchObject({ success: false, error: { code: "BLOCKED_HOST" } });

  const article = await request.get(`/api/article?url=${encodeURIComponent("http://localhost/admin")}`);
  expect((await article.json()).error.code).toBe("BLOCKED_HOST");

  const missing = await request.get("/api/does-not-exist");
  expect(missing.status()).toBe(404);
  expect(missing.headers()["content-type"]).toContain("application/json");
  const text = await missing.text();
  expect(text).not.toMatch(/stack|node_modules|\/srv\/|at .*\.js:\d+/i);
});

test("no CSP violations and no requests to other websites during normal use", async ({ page }) => {
  const getViolations = await watchCspViolations(page);
  const external: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.hostname !== "localhost") external.push(url.host);
  });
  await mockApis(page);

  await page.goto("/");
  await loadFeed(page);
  await page.locator("#main > div").first().getByRole("article", { name: "Why feeds still matter" }).getByRole("button", { name: /^Read/ }).click();
  await expect(page.getByRole("dialog").locator(".article-content")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.goto("/radar");
  await expect(page.getByRole("heading", { name: "Personal Knowledge Radar" })).toBeVisible();

  expect(external).toEqual([]); // fonts, analytics, images, CDNs: none
  expect(await getViolations()).toEqual([]);
});

test("the CSP blocks requests and scripts from other websites", async ({ page }) => {
  const getViolations = await watchCspViolations(page);
  await page.goto("/");
  const result = await page.evaluate(async () => {
    try {
      await fetch("https://tracker.example/collect");
      return "fetch allowed";
    } catch {
      return "fetch blocked";
    }
  });
  expect(result).toBe("fetch blocked");
  await page.evaluate(() => {
    const script = document.createElement("script");
    script.src = "https://cdn.example/evil.js";
    document.head.append(script);
  });
  await expect.poll(getViolations).toEqual(expect.arrayContaining([expect.stringMatching(/^connect-src/), expect.stringMatching(/^script-src/)]));
});

test("enabling local AI works under the CSP and only contacts huggingface.co", async ({ page, context }) => {
  const getViolations = await watchCspViolations(page);
  const hosts = new Set<string>();
  context.on("request", (request) => {
    const url = new URL(request.url());
    if (url.hostname !== "localhost") hosts.add(url.hostname);
  });
  await page.goto("/");
  const enable = page.getByRole("button", { name: /Download & enable local AI/ });
  await page.getByText(/Download & enable local AI|Local AI is not available/).first().waitFor(); // support check finished
  test.skip(!(await enable.isVisible()), "Local AI not supported in this browser build");
  expect(hosts.size).toBe(0); // nothing downloaded before the click
  await enable.click();
  // The worker starts and begins the model download. (In CI or a sandbox without
  // internet the download then fails, which the panel reports.)
  await expect.poll(() => [...hosts], { timeout: 20_000 }).toContain("huggingface.co");
  for (const host of hosts) expect(host.endsWith("huggingface.co") || host.endsWith(".hf.co")).toBe(true);
  expect(await getViolations()).toEqual([]);
});
