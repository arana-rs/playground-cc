import { paraglideVitePlugin } from '@inlang/paraglide-js';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Its options are in project.inlang/paraglide.config.ts.
    paraglideVitePlugin({ project: './project.inlang' }),
  ],
  worker: { format: 'es' },
  // React and CodeMirror make the page's chunk about 700 kB (220 kB compressed): one chunk, on
  // purpose, since the page needs all of it at once.
  build: { target: 'es2022', chunkSizeWarningLimit: 1024 },
  test: { setupFiles: ['./tests/setup.ts'] },
});
