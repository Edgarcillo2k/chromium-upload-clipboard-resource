/**
 * End-to-end test: loads dist/ as an unpacked extension into a real Chromium-based
 * browser and exercises test/pages/{plain,dropzone}.html.
 *
 *   pnpm build && pnpm test:e2e
 *
 * Browser: Playwright's Chromium (install once with `pnpm exec playwright-core install chromium`),
 * or any Chromium-based browser via CHROME_PATH (e.g. CHROME_PATH=/usr/bin/brave).
 * Set HEADED=1 to watch it run, ONLY=<substring> to run matching tests.
 */
import { chromium, type BrowserContext, type Page } from 'playwright-core';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { serve } from './serve.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extDir = path.join(root, 'dist');
const PORT = 5180;
const BASE = `http://127.0.0.1:${PORT}`;
const HOST_SEL = 'paste-to-upload-popover';

// Default: Playwright's own Chromium build (`pnpm exec playwright-core install chromium`).
// CHROME_PATH=/usr/bin/brave runs the suite against another Chromium-based browser.
const executablePath = process.env.CHROME_PATH;
if (!existsSync(path.join(extDir, 'manifest.json'))) throw new Error('dist/ is missing; run `pnpm build` first.');

// ---- helpers -------------------------------------------------------------------------

async function popoverOpen(page: Page): Promise<boolean> {
  return page.evaluate((sel) => !!document.querySelector(sel), HOST_SEL);
}

async function waitPopover(page: Page, open = true): Promise<void> {
  await page.waitForFunction(([sel, want]) => !!document.querySelector(sel as string) === want, [HOST_SEL, open] as const, {
    timeout: 3000,
  });
}

/** Puts a small generated PNG (or text) on the real system clipboard. */
async function copyImage(page: Page, color = '#e33'): Promise<void> {
  await page.evaluate(async (fill) => {
    const c = new OffscreenCanvas(32, 24);
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, 32, 24);
    const blob = await c.convertToBlob({ type: 'image/png' });
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  }, color);
}
async function copyText(page: Page, text: string): Promise<void> {
  await page.evaluate((t) => navigator.clipboard.writeText(t), text);
}

type Upload = { label: string; files: { name: string; type: string; size: number }[] };
async function uploads(page: Page): Promise<Upload[]> {
  return page.evaluate(() => (window as unknown as { uploads: Upload[] }).uploads);
}
async function waitUploads(page: Page, n: number): Promise<Upload[]> {
  await page.waitForFunction((count) => (window as unknown as { uploads: unknown[] }).uploads.length >= count, n, {
    timeout: 3000,
  });
  return uploads(page);
}

/** Asserts that a native file chooser opens as a result of `action`. */
async function expectFileChooser(page: Page, action: () => Promise<unknown>): Promise<void> {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 3000 }), action()]);
  assert.ok(chooser, 'native file chooser should open');
  await chooser.setFiles([]);
}

/** Asserts that NO native chooser opens (the popover intercepted it). */
async function expectNoFileChooser(page: Page, action: () => Promise<unknown>): Promise<void> {
  let opened = false;
  const onChooser = () => (opened = true);
  page.on('filechooser', onChooser);
  await action();
  await page.waitForTimeout(300);
  page.off('filechooser', onChooser);
  assert.equal(opened, false, 'native file chooser should NOT open');
}

async function pasteAndExpect(page: Page, n: number): Promise<Upload> {
  await page.keyboard.press('Control+V');
  const ups = await waitUploads(page, n);
  await waitPopover(page, false);
  return ups[n - 1]!;
}

const PASTED_PNG = /^pasted-\d{4}-\d{2}-\d{2}-\d{6}\.png$/;

// ---- tests ---------------------------------------------------------------------------

const tests: [string, (ctx: BrowserContext, page: Page) => Promise<void>][] = [];
const only = process.env.ONLY;
const test = (name: string, fn: (ctx: BrowserContext, page: Page) => Promise<void>) => {
  if (!only || name.includes(only)) tests.push([name, fn]);
};

test('plain: clicking a visible input shows the popover, Ctrl+V inserts a pasted PNG', async (_c, page) => {
  await page.goto(`${BASE}/plain.html`);
  await copyImage(page);
  await expectNoFileChooser(page, () => page.click('#any'));
  assert.ok(await popoverOpen(page), 'popover visible');
  const up = await pasteAndExpect(page, 1);
  assert.equal(up.label, 'any');
  assert.equal(up.files.length, 1);
  assert.match(up.files[0]!.name, PASTED_PNG);
  assert.equal(up.files[0]!.type, 'image/png');
  const inInput = await page.$eval('#any', (el) => (el as HTMLInputElement).files?.[0]?.name);
  assert.match(inInput ?? '', PASTED_PNG, 'input.files holds the pasted file');
});

test('plain: Esc closes the popover and fires cancel', async (_c, page) => {
  await page.goto(`${BASE}/plain.html`);
  await page.click('#any');
  await waitPopover(page);
  await page.keyboard.press('Escape');
  await waitPopover(page, false);
  await page.waitForFunction(() => (window as unknown as { cancels: number }).cancels === 1, null, { timeout: 2000 });
});

test('plain: clicking outside closes the popover', async (_c, page) => {
  await page.goto(`${BASE}/plain.html`);
  await page.click('#any');
  await waitPopover(page);
  await page.mouse.click(5, 5);
  await waitPopover(page, false);
});

test('plain: "Browse files…" opens the native picker', async (_c, page) => {
  await page.goto(`${BASE}/plain.html`);
  await page.click('#any');
  await waitPopover(page);
  // Focus starts on "Paste"; Tab moves to "Browse files…".
  await page.keyboard.press('Tab');
  await expectFileChooser(page, () => page.keyboard.press('Enter'));
  await waitPopover(page, false);
});

test('plain: "Browse files…" via mouse click opens the native picker', async (_c, page) => {
  await page.goto(`${BASE}/plain.html`);
  await page.click('#images');
  await waitPopover(page);
  const box = (await page.locator(HOST_SEL).boundingBox())!;
  // Card layout: 8px padding, header ~28px, paste option ~60px, browse option below.
  await expectFileChooser(page, () => page.mouse.click(box.x + box.width / 2, box.y + 8 + 28 + 62 + 30));
});

test('plain: Shift+click bypasses the popover', async (_c, page) => {
  await page.goto(`${BASE}/plain.html`);
  await expectFileChooser(page, () => page.click('#any', { modifiers: ['Shift'] }));
  assert.equal(await popoverOpen(page), false);
});

test('plain: <label for> pointing at a display:none input', async (_c, page) => {
  await page.goto(`${BASE}/plain.html`);
  await copyImage(page);
  await expectNoFileChooser(page, () => page.click('#labelzone'));
  const up = await pasteAndExpect(page, 1);
  assert.equal(up.label, 'labelled');
});

test('plain: multiple input appends on repeated pastes', async (_c, page) => {
  await page.goto(`${BASE}/plain.html`);
  await copyImage(page, '#e33');
  await page.click('#multi');
  await waitPopover(page);
  await pasteAndExpect(page, 1);
  await copyImage(page, '#3e3');
  await page.click('#multi');
  await waitPopover(page);
  const up = await pasteAndExpect(page, 2);
  assert.equal(up.files.length, 2, 'second paste appends to the first');
});

test('plain: accept=".pdf" rejects an image (no insertion, popover stays with a warning)', async (_c, page) => {
  await page.goto(`${BASE}/plain.html`);
  await copyImage(page);
  await page.click('#pdf');
  await waitPopover(page);
  await page.keyboard.press('Control+V');
  await page.waitForTimeout(400);
  assert.equal((await uploads(page)).length, 0);
  assert.ok(await popoverOpen(page), 'popover still open showing the warning');
});

test('plain: accept="image/jpeg" converts the pasted PNG to JPEG', async (_c, page) => {
  await page.goto(`${BASE}/plain.html`);
  await copyImage(page);
  await page.click('#jpeg');
  await waitPopover(page);
  const up = await pasteAndExpect(page, 1);
  assert.equal(up.files[0]!.type, 'image/jpeg');
  assert.match(up.files[0]!.name, /^pasted-.*\.jpg$/);
});

test('plain: copied text becomes a .txt file', async (_c, page) => {
  await page.goto(`${BASE}/plain.html`);
  await copyText(page, 'hello from the clipboard');
  await page.click('#any');
  await waitPopover(page);
  const up = await pasteAndExpect(page, 1);
  assert.equal(up.files[0]!.type, 'text/plain');
  assert.match(up.files[0]!.name, /^pasted-.*\.txt$/);
  assert.equal(up.files[0]!.size, 'hello from the clipboard'.length);
});

test('plain: a file copied in the file manager (file:// URI) is refused', async (_c, page) => {
  await page.goto(`${BASE}/plain.html`);
  await copyText(page, 'x-special/nautilus-clipboard\ncopy\nfile:///home/me/photo.jpg');
  await page.click('#any');
  await waitPopover(page);
  await page.keyboard.press('Control+V');
  await page.waitForTimeout(400);
  assert.equal((await uploads(page)).length, 0);
  assert.ok(await popoverOpen(page));
});

test('plain: the paste does not leak to page paste handlers', async (_c, page) => {
  await page.goto(`${BASE}/plain.html`);
  await page.evaluate(() => {
    (window as unknown as { pageSawPaste: boolean }).pageSawPaste = false;
    document.addEventListener('paste', () => ((window as unknown as { pageSawPaste: boolean }).pageSawPaste = true));
  });
  await copyImage(page);
  await page.click('#any');
  await waitPopover(page);
  await pasteAndExpect(page, 1);
  assert.equal(await page.evaluate(() => (window as unknown as { pageSawPaste: boolean }).pageSawPaste), false);
});

test('plain: the "Paste" button uses navigator.clipboard.read()', async (_c, page) => {
  await page.goto(`${BASE}/plain.html`);
  await copyImage(page);
  await page.click('#formfile');
  await waitPopover(page);
  const box = (await page.locator(HOST_SEL).boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + 8 + 28 + 30);
  const ups = await waitUploads(page, 1);
  assert.equal(ups[0]!.label, 'formfile');
  assert.match(ups[0]!.files[0]!.name, PASTED_PNG);
});

test('dropzone: hidden input opened with input.click()', async (_c, page) => {
  await page.goto(`${BASE}/dropzone.html`);
  await copyImage(page);
  await expectNoFileChooser(page, () => page.click('#zone'));
  assert.ok(await popoverOpen(page));
  // Anchored next to the zone that was clicked, not at (0,0).
  const [pop, zone] = await Promise.all([page.locator(HOST_SEL).boundingBox(), page.locator('#zone').boundingBox()]);
  assert.ok(Math.abs(pop!.y - (zone!.y + zone!.height)) < 20, 'popover sits below the clicked zone');
  const up = await pasteAndExpect(page, 1);
  assert.equal(up.label, 'hidden');
  assert.match(up.files[0]!.name, PASTED_PNG);
});

test('dropzone: hidden multiple input replaces (no duplicate re-uploads)', async (_c, page) => {
  await page.goto(`${BASE}/dropzone.html`);
  await copyImage(page);
  await page.click('#zone');
  await waitPopover(page);
  await pasteAndExpect(page, 1);
  await page.click('#zone');
  await waitPopover(page);
  const up = await pasteAndExpect(page, 2);
  assert.equal(up.files.length, 1);
});

test('dropzone: detached input (never in the DOM)', async (_c, page) => {
  await page.goto(`${BASE}/dropzone.html`);
  await copyImage(page);
  await expectNoFileChooser(page, () => page.click('#detachedzone'));
  const up = await pasteAndExpect(page, 1);
  assert.equal(up.label, 'detached');
});

test('dropzone: input.showPicker()', async (_c, page) => {
  await page.goto(`${BASE}/dropzone.html`);
  await copyImage(page);
  await expectNoFileChooser(page, () => page.click('#pickerbtn'));
  const up = await pasteAndExpect(page, 1);
  assert.equal(up.label, 'showPicker');
});

test('dropzone: Browse from a programmatic click() opens the native picker', async (_c, page) => {
  await page.goto(`${BASE}/dropzone.html`);
  await page.click('#zone');
  await waitPopover(page);
  await page.keyboard.press('Tab');
  await expectFileChooser(page, () => page.keyboard.press('Enter'));
});

test('dropzone: Shift+click on the zone bypasses the popover', async (_c, page) => {
  await page.goto(`${BASE}/dropzone.html`);
  await expectFileChooser(page, () => page.click('#zone', { modifiers: ['Shift'] }));
  assert.equal(await popoverOpen(page), false);
});

test('dropzone: opacity-0 input over the zone (react-dropzone style)', async (_c, page) => {
  await page.goto(`${BASE}/dropzone.html`);
  await copyImage(page);
  await expectNoFileChooser(page, () => page.click('#reactish'));
  const up = await pasteAndExpect(page, 1);
  assert.equal(up.label, 'react');
});

test('dropzone: input inside an open shadow root', async (_c, page) => {
  await page.goto(`${BASE}/dropzone.html`);
  await copyImage(page);
  await expectNoFileChooser(page, () => page.locator('#shadowinput').click());
  const up = await pasteAndExpect(page, 1);
  assert.equal(up.label, 'shadow');
});

test('dropzone: upload inside a modal <dialog> (popover in the top layer)', async (_c, page) => {
  await page.goto(`${BASE}/dropzone.html`);
  await copyImage(page);
  await page.click('#opendialog');
  await expectNoFileChooser(page, () => page.click('#dialogzone'));
  // The popover must be clickable above the modal: hit-test its centre.
  const box = (await page.locator(HOST_SEL).boundingBox())!;
  const hit = await page.evaluate(
    ([x, y, sel]) => document.elementFromPoint(x as number, y as number)?.localName === sel,
    [box.x + box.width / 2, box.y + box.height / 2, HOST_SEL] as const,
  );
  assert.ok(hit, 'popover is on top of the modal dialog');
  const up = await pasteAndExpect(page, 1);
  assert.equal(up.label, 'dialog');
});

test('options: a denylisted site gets the native picker', async (ctx, page) => {
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  const extId = new URL(sw.url()).host;
  await page.goto(`chrome-extension://${extId}/options.html`);
  await page.fill('textarea[name="sites"]', 'https://127.0.0.1/whatever\n# a comment');
  await page.locator('textarea[name="sites"]').blur();
  await page.waitForSelector('#saved:text("Saved")');
  assert.equal(await page.inputValue('textarea[name="sites"]'), '127.0.0.1\n# a comment', 'site normalised');

  await page.goto(`${BASE}/plain.html`);
  await page.waitForTimeout(200);
  await expectFileChooser(page, () => page.click('#any'));
  assert.equal(await popoverOpen(page), false);

  // Switch to allowlist mode with the same list: enabled again.
  await page.goto(`chrome-extension://${extId}/options.html`);
  await page.check('input[name="mode"][value="allowlist"]');
  await page.waitForSelector('#saved:text("Saved")');
  await page.goto(`${BASE}/plain.html`);
  await page.waitForTimeout(200);
  await expectNoFileChooser(page, () => page.click('#any'));
  assert.ok(await popoverOpen(page));

  await page.goto(`chrome-extension://${extId}/options.html`);
  await page.evaluate(() => chrome.storage.sync.clear());
});

// ---- runner --------------------------------------------------------------------------

const server = await serve(PORT);
if (process.env.DEBUG_SERVER) server.on('request', (r) => console.log('    [server]', r.method, r.url));
const userDataDir = mkdtempSync(path.join(tmpdir(), 'ptu-e2e-'));
console.log(`Browser: ${executablePath ?? "Playwright Chromium"}`);
const ctx = await chromium.launchPersistentContext(userDataDir, {
  ...(executablePath ? { executablePath } : { channel: 'chromium' }), // full Chromium: headless shell has no extensions
  headless: !process.env.HEADED,
  args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`, '--no-first-run', '--no-default-browser-check'],
  permissions: ['clipboard-read', 'clipboard-write'],
});
let failed = 0;
try {
  for (const [name, fn] of tests) {
    const page = await ctx.newPage();
    try {
      await fn(ctx, page);
      console.log(`  ✓ ${name}`);
    } catch (err) {
      failed++;
      console.log(`  ✗ ${name}\n    ${String((err as Error).stack ?? err).split('\n').slice(0, 4).join('\n    ')}`);
    } finally {
      await page.close();
    }
  }
} finally {
  await ctx.close();
  server.close();
  rmSync(userDataDir, { recursive: true, force: true });
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
process.exit(failed ? 1 : 0);
