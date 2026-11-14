/**
 * Packs dist/ into release/paste-to-upload-v<version>.zip, with manifest.json at
 * the root of the zip: the format "Load unpacked" (after unzipping) and the
 * Chrome Web Store both expect. Pure Node, no external `zip` binary needed.
 *
 *   pnpm package   (builds first)
 */
import { zipSync, type Zippable } from 'fflate';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));

const files: Zippable = {};
for (const entry of await readdir(dist, { recursive: true, withFileTypes: true })) {
  if (!entry.isFile()) continue;
  const abs = path.join(entry.parentPath, entry.name);
  const rel = path.relative(dist, abs).split(path.sep).join('/');
  files[rel] = await readFile(abs);
}
if (!files['manifest.json']) throw new Error('dist/manifest.json missing; run `pnpm build` first.');

const out = path.join(root, 'release', `paste-to-upload-v${version}.zip`);
await mkdir(path.dirname(out), { recursive: true });
await writeFile(out, zipSync(files, { level: 9 }));
console.log(`${path.relative(root, out)} (${Object.keys(files).length} files)`);
