/** Handling of the input's `accept` attribute. */

export function parseAccept(accept: string): string[] {
  return accept
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
}

export function fileMatches(file: File, tokens: string[]): boolean {
  if (!tokens.length) return true;
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  return tokens.some((t) => {
    if (t.startsWith('.')) return name.endsWith(t);
    if (t.endsWith('/*')) return type.startsWith(t.slice(0, -1));
    return type === t;
  });
}

/** Human-readable summary, e.g. "image/*, .pdf". */
export function describeAccept(tokens: string[]): string {
  return tokens.join(', ');
}

const CONVERTIBLE: [token: string, type: string, ext: string][] = [
  ['image/png', 'image/png', 'png'],
  ['.png', 'image/png', 'png'],
  ['image/jpeg', 'image/jpeg', 'jpg'],
  ['image/jpg', 'image/jpeg', 'jpg'],
  ['.jpg', 'image/jpeg', 'jpg'],
  ['.jpeg', 'image/jpeg', 'jpg'],
  ['image/webp', 'image/webp', 'webp'],
  ['.webp', 'image/webp', 'webp'],
];

/**
 * If `file` is a raster image the input doesn't accept as-is, but the input
 * accepts another raster format we can encode (png/jpeg/webp), convert it.
 */
export async function convertImageIfNeeded(file: File, tokens: string[]): Promise<File | null> {
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') return null;
  const target = CONVERTIBLE.find(([token]) => tokens.includes(token));
  if (!target) return null;
  const [, type, ext] = target;
  try {
    const bitmap = await createImageBitmap(file);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d')!;
    if (type === 'image/jpeg') {
      ctx.fillStyle = '#fff'; // JPEG has no alpha
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const blob = await canvas.convertToBlob({ type, quality: 0.92 });
    const base = file.name.replace(/\.[^.]+$/, '');
    return new File([blob], `${base}.${ext}`, { type, lastModified: Date.now() });
  } catch {
    return null;
  }
}
