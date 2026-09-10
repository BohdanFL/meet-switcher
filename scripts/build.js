import { build } from 'vite';
import fs from 'fs';
import path from 'path';

async function run() {
  const isWatch = process.argv.includes('--watch');

  console.log('🚀 Building MeetSwitcher Chrome Extension...');

  // 1. Build content script as IIFE
  await build({
    configFile: false,
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      sourcemap: true,
      watch: isWatch ? {} : null,
      lib: {
        entry: path.resolve('src/content/index.ts'),
        name: 'MeetSwitcher',
        formats: ['iife'],
        fileName: () => 'content.js',
      },
    },
  });

  // 2. Build background service worker
  await build({
    configFile: false,
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      sourcemap: true,
      watch: isWatch ? {} : null,
      lib: {
        entry: path.resolve('src/background/service-worker.ts'),
        formats: ['es'],
        fileName: () => 'background.js',
      },
    },
  });

  // 3. Copy manifest.json
  if (fs.existsSync('manifest.json')) {
    fs.copyFileSync('manifest.json', 'dist/manifest.json');
    console.log('✓ Copied manifest.json to dist/');
  }

  // 4. Copy icons
  if (fs.existsSync('icons')) {
    fs.cpSync('icons', 'dist/icons', { recursive: true });
    console.log('✓ Copied icons/ to dist/');
  }

  console.log('✅ Build complete! Extension ready in dist/');
}

run().catch((err) => {
  console.error('❌ Build failed:', err);
  process.exit(1);
});
