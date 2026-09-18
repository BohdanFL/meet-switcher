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

  // 3. Build popup script
  await build({
    configFile: false,
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      sourcemap: true,
      watch: isWatch ? {} : null,
      lib: {
        entry: path.resolve('src/popup/popup.ts'),
        formats: ['es'],
        fileName: () => 'popup.js',
      },
    },
  });

  // 4. Build LMS content script
  await build({
    configFile: false,
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      sourcemap: true,
      watch: isWatch ? {} : null,
      lib: {
        entry: path.resolve('src/lms/index.ts'),
        name: 'MeetSwitcherLMS',
        formats: ['iife'],
        fileName: () => 'lms.js',
      },
    },
  });

  // 4. Copy manifest.json
  if (fs.existsSync('manifest.json')) {
    fs.copyFileSync('manifest.json', 'dist/manifest.json');
    console.log('✓ Copied manifest.json to dist/');
  }

  // 5. Copy icons
  if (fs.existsSync('icons')) {
    fs.cpSync('icons', 'dist/icons', { recursive: true });
    console.log('✓ Copied icons/ to dist/');
  }

  // 6. Copy popup assets
  if (fs.existsSync('src/popup/popup.html')) {
    fs.copyFileSync('src/popup/popup.html', 'dist/popup.html');
    console.log('✓ Copied popup.html to dist/');
  }
  if (fs.existsSync('src/popup/popup.css')) {
    fs.copyFileSync('src/popup/popup.css', 'dist/popup.css');
    console.log('✓ Copied popup.css to dist/');
  }

  console.log('✅ Build complete! Extension ready in dist/');
}

run().catch((err) => {
  console.error('❌ Build failed:', err);
  process.exit(1);
});
