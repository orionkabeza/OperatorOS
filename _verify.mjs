import { chromium } from "playwright";
const shots = "C:/Users/HQ/AppData/Local/Temp/claude/c--Users-HQ-Desktop-BSE-sandbox-OperatorOS/3bf7482f-a9a8-41f2-8e11-85f650dfef2f/scratchpad";
const D = "https://operatoros.orion-labs.dev";

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push("PAGEERROR: " + String(e)));
page.on("framenavigated", (f) => { if (f === page.mainFrame()) console.log("NAV ->", f.url()); });

await page.goto(`${D}/login`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
console.log("url after settle:", page.url());
console.log("password inputs on page:", await page.locator("input[type=password]").count());
await page.screenshot({ path: `${shots}/debug-login.png` });
console.log("CONSOLE_ERRORS:", JSON.stringify(errors));
await browser.close();
