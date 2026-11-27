import { readFileSync } from 'node:fs';
import { paraglideVitePlugin } from '@inlang/paraglide-js';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { licenses } from './licenses.ts';

const root = import.meta.dirname;
const { version } = JSON.parse(readFileSync(`${root}/package.json`, 'utf8'));

/**
 * Where the source of this build is: set `VITE_SOURCE_URL` when serving a modified build; by
 * default the official repository at the release's tag (design/licensing.md).
 */
const sourceUrl =
  process.env.VITE_SOURCE_URL || `https://github.com/arana-rs/playground-cc/tree/v${version}`;

const notices = licenses({
  root,
  allowlist: 'license-allowlist.json',
  license: '../LICENSE',
  sourceUrl,
  extras: [
    {
      name: 'shadcn/ui',
      license: 'MIT',
      dir: 'src/components/ui',
      how: 'code copied into the site',
    },
    {
      name: 'tokyonight.nvim',
      license: 'Apache-2.0',
      dir: 'src/tokyonight',
      how: 'colors copied into the site',
    },
    {
      package: '@inlang/paraglide-js',
      how: 'its runtime and message functions are generated into the bundle',
    },
    { package: 'tailwindcss', how: 'its styles are generated into the bundle' },
  ],
});

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Its options are in project.inlang/paraglide.config.ts.
    paraglideVitePlugin({ project: './project.inlang' }),
    notices.main,
  ],
  define: { 'import.meta.env.VITE_SOURCE_URL': JSON.stringify(sourceUrl) },
  worker: { format: 'es', plugins: () => [notices.collect()] },
  // React and CodeMirror make the page's chunk about 700 kB (220 kB compressed): one chunk, on
  // purpose, since the page needs all of it at once.
  build: { target: 'es2022', chunkSizeWarningLimit: 1024 },
  test: { setupFiles: ['./tests/setup.ts'] },
});
