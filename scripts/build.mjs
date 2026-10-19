import { build } from 'vite';
import { mkdir, copyFile, cp } from 'node:fs/promises';
await build({ configFile: false, build: {
  outDir: 'dist', emptyOutDir: true, target: 'es2022', cssMinify: false,
  rollupOptions: { input: { popup: 'popup.html', options: 'options.html', background: 'src/background.ts' },
    output: { entryFileNames: '[name].js', chunkFileNames: 'chunks/[name]-[hash].js' } }
}});
await build({ configFile: false, publicDir: false, build: {
  outDir: 'dist', emptyOutDir: false, target: 'es2022',
  lib: { entry: 'src/content.ts', name: 'PaperNamerContent', formats: ['iife'], fileName: () => 'content.js' }
}});
await mkdir('dist', { recursive: true });
await copyFile('public/manifest.json', 'dist/manifest.json');
await copyFile('README.md', 'dist/README.md');
await copyFile('TESTING.md', 'dist/TESTING.md');
await cp('docs', 'dist/docs', { recursive: true });
