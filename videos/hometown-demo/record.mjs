// Records one continuous 1920x1080 session of the live Hometown app and writes markers.json
// with the elapsed seconds of each beat, so build.mjs can cut scenes out of the single take.
// Run: npx playwright install chromium; node record.mjs ./rec (needs the playwright package on the import path), then node build.mjs
import pw from "playwright";
const { chromium } = pw;
import { writeFileSync, readdirSync, renameSync } from "node:fs";

const OUT = process.argv[2] ?? "./rec";
const URL = process.env.URL ?? "https://hometown.shrikar84.workers.dev/";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, recordVideo: { dir: OUT, size: { width: 1920, height: 1080 } } });
const page = await ctx.newPage();
const t0 = Date.now();
const marks = {};
const mark = (k) => { marks[k] = +((Date.now() - t0) / 1000).toFixed(2); console.log(k, marks[k]); };
const sleep = (ms) => page.waitForTimeout(ms);
// The app only re-enables the button when the turn is done.
const waitDone = async (timeout = 240000) => page.waitForFunction(() => !document.querySelector("#go").disabled && !document.querySelector("#memo").hidden, null, { timeout });

await page.goto(URL, { waitUntil: "networkidle" });
mark("hero");
await sleep(2500);

await page.click("#act");
await page.type("#act", "Khruangbin", { delay: 110 });
mark("typed");
await page.waitForSelector("#suggest li", { timeout: 8000 }).catch(() => {});
await sleep(1600);
mark("suggest");
await page.click("#suggest li >> nth=0").catch(() => page.keyboard.press("Escape"));
await sleep(700);
await page.selectOption("#region", "us-south");
await sleep(500);
await page.selectOption("#kind", "music");
await sleep(900);
await page.click("#go", { force: true });
mark("route");

await page.waitForSelector("#markets:not([hidden]) .m", { timeout: 60000 });
mark("markets");
await page.waitForSelector(".stop", { timeout: 120000 });
mark("first_stop");
await page.waitForSelector("#crowd:not([hidden])", { timeout: 120000 }).catch(() => {});
mark("crowd");
await waitDone();
mark("done");
await sleep(2500);

// Tour book walk: scroll the stage book smoothly.
const scrollBook = async (sel, offset = -16) => page.evaluate(([s, o]) => { const el = document.querySelector(s); const book = document.querySelector("#book"); book.scrollTo({ top: el.offsetTop - book.offsetTop + o, behavior: "smooth" }); }, [sel, offset]);
await scrollBook(".stop:nth-of-type(1)");
mark("stop1");
await sleep(4000);
await scrollBook(".stop:nth-of-type(3)");
mark("stop3");
await sleep(4000);
await scrollBook("#crowd");
mark("crowd_view");
await sleep(4000);

// Memo on the run sheet.
await page.evaluate(() => { const s = document.querySelector(".sheet"); const m = document.querySelector("#memo"); s.scrollTo({ top: m.offsetTop - 80, behavior: "smooth" }); });
mark("memo");
await sleep(4500);
await page.evaluate(() => { const s = document.querySelector(".sheet"); s.scrollTo({ top: s.scrollHeight, behavior: "smooth" }); });
await sleep(2500);

// Follow-up.
await page.click("#ask");
await page.type("#ask", "Swap Miami for Nashville", { delay: 90 });
await sleep(600);
await page.keyboard.press("Enter");
mark("followup");
await page.waitForFunction(() => document.querySelector("#go").disabled, null, { timeout: 10000 }).catch(() => {});
await waitDone();
mark("followup_done");
await sleep(1500);
await page.evaluate(() => { const s = document.querySelector(".sheet"); s.scrollTo({ top: s.scrollHeight, behavior: "smooth" }); });
await sleep(5000);
await scrollBook("#markets", -80);
mark("end_markets");
await sleep(4000);
mark("end");

const video = page.video();
await ctx.close();
const path = await video.path();
await browser.close();
renameSync(path, `${OUT}/take.webm`);
writeFileSync(`${OUT}/markers.json`, JSON.stringify(marks, null, 2));
console.log("saved", `${OUT}/take.webm`, marks);
