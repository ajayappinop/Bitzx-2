import { chromium } from "playwright";

const url = process.argv[2] || "http://127.0.0.1:3456/";

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];

page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(`console: ${m.text()}`);
});

await page.goto(url, { waitUntil: "networkidle", timeout: 90000 });
const rootLen = await page.locator("#root").innerHTML().then((h) => h.length);
const title = await page.title();

console.log(JSON.stringify({ url, title, rootHtmlLength: rootLen, errors }, null, 2));
await browser.close();
