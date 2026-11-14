/** Regenerates public/icons/*.png from assets/icon.svg (needs `rsvg-convert` from librsvg). */
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

mkdirSync('public/icons', { recursive: true });
for (const size of [16, 32, 48, 128]) {
  execFileSync('rsvg-convert', ['-w', String(size), '-h', String(size), 'assets/icon.svg', '-o', `public/icons/icon-${size}.png`]);
  console.log(`public/icons/icon-${size}.png`);
}
