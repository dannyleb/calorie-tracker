// Renders public/icon.svg to the PNG sizes iOS and the web manifest need.
// Usage: npm i -D playwright && npx playwright install chromium && node scripts/make-icons.mjs
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const publicDir = process.env.PUBLIC_DIR || fileURLToPath(new URL('../public/', import.meta.url));
const svg = readFileSync(join(publicDir, 'icon.svg'), 'utf8');
const targets = [
  { file: 'apple-touch-icon.png', size: 180, pad: 0, square: true },
  { file: 'icon-192.png', size: 192, pad: 0 },
  { file: 'icon-512.png', size: 512, pad: 0 },
  { file: 'icon-maskable-512.png', size: 512, pad: 0.1, square: true },
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const t of targets) {
  // iOS rounds corners itself, so the touch icon and maskable icon are full-bleed squares.
  const body = t.square ? svg.replace(/rx="\d+"/, 'rx="0"') : svg;
  const inner = Math.round(t.size * (1 - t.pad * 2));
  await page.setViewportSize({ width: t.size, height: t.size });
  await page.setContent(
    `<html><body style="margin:0;background:${t.square ? '#1f5fae' : 'transparent'};display:grid;place-items:center;width:${t.size}px;height:${t.size}px">
      <div style="width:${inner}px;height:${inner}px">${body.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</div></body></html>`,
  );
  await page.screenshot({ path: join(publicDir, t.file), omitBackground: !t.square });
  console.log('wrote', t.file);
}
await browser.close();
