/** Renders docs/popover-*.png for the README (uses the e2e browser setup). */
import { chromium } from 'playwright-core';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { serve } from './serve.ts';

const ext = path.resolve('dist');
const server = await serve(5182);
for (const scheme of ['light', 'dark'] as const) {
  const ctx = await chromium.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'ptu-shot-')), {
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chromium' }),
    headless: true,
    colorScheme: scheme,
    viewport: { width: 760, height: 420 },
    deviceScaleFactor: 2,
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:5182/dropzone.html');
  if (scheme === 'dark') await page.addStyleTag({ content: 'body{background:#111;color:#eee}' });
  await page.evaluate(async () => {
    const c = new OffscreenCanvas(320, 200);
    const g = c.getContext('2d')!;
    const grad = g.createLinearGradient(0, 0, 320, 200);
    grad.addColorStop(0, '#4f8cff');
    grad.addColorStop(1, '#b14fff');
    g.fillStyle = grad;
    g.fillRect(0, 0, 320, 200);
    g.fillStyle = '#fff';
    g.font = 'bold 40px sans-serif';
    g.fillText('screenshot', 50, 115);
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': await c.convertToBlob() })]);
  });
  await page.click('#zone');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `docs/popover-${scheme}.png`, clip: { x: 0, y: 60, width: 760, height: 360 } });
  await ctx.close();
}
server.close();
console.log('docs/popover-light.png, docs/popover-dark.png');
