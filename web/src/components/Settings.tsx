// The settings menu: the language, the theme, and the Source code and Licenses links
// (design/frontend-screens.md#desktop, design/licensing.md). A native
// popover, so Escape, clicking outside and the focus return work as the browser does them.
import { ExternalLink as ExternalIcon, Settings as SettingsIcon } from 'lucide-react';
import { type ReactNode, useId } from 'react';
import { m } from '../paraglide/messages';
import { type Locale, locales } from '../paraglide/runtime';
import { THEMES, type Theme } from '../preferences';
import { Button } from './ui/button';

/** Each language by its own name, the same in every catalog. */
const LANGUAGE_NAMES: Record<Locale, () => string> = { en: m.language_en, es: m.language_es };

const THEME_NAMES: Record<Theme, () => string> = {
  system: m.theme_system,
  light: m.theme_light,
  dark: m.theme_dark,
};

function Choices<T extends string>({
  legend,
  name,
  values,
  label,
  lang,
  value,
  onChange,
}: {
  legend: string;
  name: string;
  values: readonly T[];
  label: (value: T) => string;
  /** The language each label is written in, when it is not the page's. */
  lang?: (value: T) => string;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="mb-1 font-medium text-muted-foreground text-xs">{legend}</legend>
      {values.map((each) => (
        <label
          key={each}
          lang={lang?.(each)}
          className="flex cursor-pointer items-center gap-2 py-0.5"
        >
          <input
            type="radio"
            name={name}
            className="accent-primary"
            checked={value === each}
            onChange={() => onChange(each)}
          />
          {label(each)}
        </label>
      ))}
    </fieldset>
  );
}

/** A link that opens in a new tab, and says so (design/licensing.md#notices-and-source-agpl-sections-6-and-13). */
function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-1.5 rounded-sm py-0.5 underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
      <ExternalIcon aria-hidden="true" className="size-3.5" />
      <span className="sr-only">{m.opens_new_tab()}</span>
    </a>
  );
}

export function Settings({
  locale,
  theme,
  onLocale,
  onTheme,
}: {
  locale: Locale;
  theme: Theme;
  onLocale: (locale: Locale) => void;
  onTheme: (theme: Theme) => void;
}) {
  const id = useId();
  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        popoverTarget={id}
        aria-label={m.settings()}
        title={m.settings()}
      >
        <SettingsIcon aria-hidden="true" />
      </Button>
      <div
        id={id}
        popover="auto"
        role="dialog"
        aria-label={m.settings()}
        className="fixed inset-auto top-12 right-2 m-0 rounded-md border bg-popover p-3 text-popover-foreground text-sm shadow-md"
      >
        {/* The layout goes inside: a display on the popover itself would show it while closed. */}
        <div className="flex flex-col gap-3">
          <Choices
            legend={m.settings_language()}
            name={`${id}-language`}
            values={locales}
            label={(each) => LANGUAGE_NAMES[each]()}
            lang={(each) => each}
            value={locale}
            onChange={onLocale}
          />
          <Choices
            legend={m.settings_theme()}
            name={`${id}-theme`}
            values={THEMES}
            label={(each) => THEME_NAMES[each]()}
            value={theme}
            onChange={onTheme}
          />
          <div className="flex flex-col gap-1 border-t pt-3">
            <ExternalLink href={import.meta.env.VITE_SOURCE_URL}>
              {m.settings_source()}
            </ExternalLink>
            <ExternalLink href={`${import.meta.env.BASE_URL}THIRD-PARTY-LICENSES.txt`}>
              {m.settings_licenses()}
            </ExternalLink>
          </div>
        </div>
      </div>
    </>
  );
}
