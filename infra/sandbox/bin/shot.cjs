// kimono-shot: see /usr/local/bin/kimono-shot.
const fs = require("node:fs");
const path = require("node:path");

const args = process.argv.slice(2);
const mobile = args.includes("--mobile");
const full = args.includes("--full");
const rest = args.filter((a) => a !== "--mobile" && a !== "--full");
const [target, ...words] = rest;
const caption = words.join(" ").trim();
if (!target) {
  console.error('usage: kimono-shot <url-or-file> ["what it shows"] [--mobile] [--full]');
  process.exit(2);
}

const dir = "/outbox/shots";
fs.mkdirSync(dir, { recursive: true });
const slug = (caption || target.replace(/^https?:\/\/[^/]+/, "") || "page")
  .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "page";
const stem = `${Date.now()}-${slug}${mobile ? "-mobile" : ""}`;

// Written under a dot name and renamed, so the node never reads half a picture.
function land(temporary, extension) {
  if (caption) fs.writeFileSync(path.join(dir, `${stem}.txt`), caption.slice(0, 300));
  fs.renameSync(temporary, path.join(dir, `${stem}.${extension}`));
  console.log(`Saved ${stem}.${extension}; it appears in the chat.`);
}

async function main() {
  if (!/^https?:\/\//i.test(target)) {
    const extension = path.extname(target).slice(1).toLowerCase().replace("jpeg", "jpg");
    if (!["png", "jpg", "webp"].includes(extension)) throw new Error("Only PNG, JPEG and WebP files can be shown.");
    const temporary = path.join(dir, `.${stem}.${extension}`);
    fs.copyFileSync(target, temporary);
    land(temporary, extension);
    return;
  }
  const { chromium } = require("playwright");
  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  try {
    const page = await browser.newPage(mobile
      ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
      : { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    try {
      await page.goto(target, { waitUntil: "networkidle", timeout: 30000 });
    } catch {
      await page.goto(target, { waitUntil: "load", timeout: 30000 });
    }
    await page.waitForTimeout(400);
    const temporary = path.join(dir, `.${stem}.png`);
    await page.screenshot({ path: temporary, fullPage: full });
    land(temporary, "png");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(`kimono-shot: ${error.message}`);
  process.exit(1);
});
