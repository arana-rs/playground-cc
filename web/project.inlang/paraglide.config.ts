// Paraglide's options, read by both the Vite plugin and the `paraglide` script.
import { defineConfig } from '@inlang/paraglide-js';

export default defineConfig({
  outdir: './src/paraglide',
  // The browser's language, matched by its base tag, or English (design/frontend.md#preferences).
  strategy: ['preferredLanguage', 'baseLocale'],
  emitTsDeclarations: true,
});
