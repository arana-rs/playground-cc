// The language and theme: they follow the browser and the system until the user chooses in the UI;
// a choice is stored in `localStorage`, per device (design/frontend.md#preferences).
import { defineCustomClientStrategy, isLocale, type Locale, setLocale } from './paraglide/runtime';

export const LOCALE_KEY = 'playground-cc.locale';
export const THEME_KEY = 'playground-cc.theme';

export const THEMES = ['system', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

/** A stored value, or undefined when there is none or `localStorage` is unavailable. */
function read(key: string): string | undefined {
  try {
    return localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

/** Stores a value; when `localStorage` is unavailable or full, the choice lasts only for the page. */
function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // The choice still applies until the page is closed.
  }
}

/** The choices made on this page, which outlive a `localStorage` that cannot store them. */
const chosen: { locale?: Locale; theme?: Theme } = {};

/**
 * The language strategy before the browser's (project.inlang/paraglide.config.ts): the language
 * chosen in the UI. Paraglide's own `setLocale` calls are not choices, so they store nothing.
 */
defineCustomClientStrategy('custom-preference', {
  getLocale: () => {
    const stored = chosen.locale ?? read(LOCALE_KEY);
    return stored !== undefined && isLocale(stored) ? stored : undefined;
  },
  setLocale: () => {},
});

export function chooseLocale(locale: Locale): void {
  chosen.locale = locale;
  write(LOCALE_KEY, locale);
  setLocale(locale, { reload: false });
}

/** The theme chosen, or `system`; a stored value outside the allowed ones is ignored. */
export function storedTheme(): Theme {
  const stored = chosen.theme ?? read(THEME_KEY);
  return THEMES.find((theme) => theme === stored) ?? 'system';
}

export function chooseTheme(theme: Theme): void {
  chosen.theme = theme;
  write(THEME_KEY, theme);
}

const DARK = '(prefers-color-scheme: dark)';

/**
 * Applies a theme to the page with the `dark` class; `system` follows the system's theme, also
 * when it changes. Returns what undoes the following.
 */
export function applyTheme(theme: Theme): () => void {
  const root = document.documentElement;
  if (theme !== 'system') {
    root.classList.toggle('dark', theme === 'dark');
    return () => {};
  }
  const media = window.matchMedia(DARK);
  const apply = () => root.classList.toggle('dark', media.matches);
  apply();
  media.addEventListener('change', apply);
  return () => media.removeEventListener('change', apply);
}

/** Forgets this page's choices; for tests, which share the module. */
export function forgetChoices(): void {
  delete chosen.locale;
  delete chosen.theme;
}
