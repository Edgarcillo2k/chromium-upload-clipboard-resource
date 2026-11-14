/**
 * Builds the extension into dist/ with Vite.
 *
 * Content scripts must be classic scripts (no `import`), and the MAIN-world
 * script must run synchronously at document_start, so each script entry is
 * built as its own self-contained IIFE bundle. The options page is a normal
 * Vite HTML build. The manifest is copied with the version from package.json.
 *
 *   node scripts/build.ts          one-off production build
 *   node scripts/build.ts --watch  rebuild on change (reload the extension after)
 */
import { build, type InlineConfig, type Plugin } from 'vite';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'dist');
const watch = process.argv.includes('--watch');

function manifestPlugin(): Plugin {
  return {
    name: 'ptu-manifest',
    async writeBundle() {
      const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
      const manifestPath = path.join(root, 'src/manifest.json');
      this.addWatchFile?.(manifestPath);
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
      manifest.version = pkg.version;
      await mkdir(outDir, { recursive: true });
      await writeFile(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    },
  };
}

const common: InlineConfig = {
  configFile: false,
  root,
  logLevel: 'warn',
  publicDir: false,
};

/** One self-contained IIFE per content/background script. */
function scriptBuild(entry: string, fileName: string): InlineConfig {
  return {
    ...common,
    build: {
      outDir,
      emptyOutDir: false,
      minify: false,
      sourcemap: watch ? 'inline' : false,
      watch: watch ? {} : null,
      lib: {
        entry: path.join(root, entry),
        formats: ['iife'],
        name: 'PasteToUpload',
        fileName: () => fileName,
      },
    },
  };
}

await rm(outDir, { recursive: true, force: true });

// 1. Options page (also copies public/ and writes the manifest).
await build({
  ...common,
  root: path.join(root, 'src/options'),
  base: './',
  publicDir: path.join(root, 'public'),
  plugins: [manifestPlugin()],
  build: {
    outDir,
    emptyOutDir: false,
    watch: watch ? {} : null,
    rollupOptions: { input: path.join(root, 'src/options/options.html') },
  },
});

// 2. Scripts.
await build(scriptBuild('src/main-world.ts', 'main-world.js'));
await build(scriptBuild('src/content/index.ts', 'content.js'));
await build(scriptBuild('src/background.ts', 'background.js'));

if (!watch) console.log(`Built extension into ${path.relative(process.cwd(), outDir) || outDir}/`);
else console.log('Watching for changes… (reload the extension in brave://extensions after a rebuild)');
