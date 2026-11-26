import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://arana-rs.github.io',
  base: '/playground-cc',
  trailingSlash: 'always',
  integrations: [
    starlight({
      title: 'playground-cc',
      defaultLocale: 'root',
      locales: {
        root: { label: 'English', lang: 'en' },
        es: { label: 'Español', lang: 'es' },
      },
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/arana-rs/playground-cc' },
      ],
      sidebar: [
        {
          label: 'Guide',
          translations: { es: 'Guía' },
          items: [{ autogenerate: { directory: 'guide' } }],
        },
        {
          label: 'Development',
          translations: { es: 'Desarrollo' },
          items: [{ autogenerate: { directory: 'development' } }],
        },
      ],
    }),
  ],
});
