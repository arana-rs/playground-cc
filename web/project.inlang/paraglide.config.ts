// Paraglide's options, read by both the Vite plugin and the `paraglide` script.
import { defineConfig } from '@inlang/paraglide-js';

export default defineConfig({
  outdir: './src/paraglide',
  // The language chosen in the UI (preferences.ts), else the browser's, matched by its base tag,
  // else English (design/frontend.md#preferences).
  strategy: ['custom-preference', 'preferredLanguage', 'baseLocale'],
  emitTsDeclarations: true,
});
