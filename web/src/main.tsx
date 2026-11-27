import './index.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { m } from './paraglide/messages';
import { getLocale } from './paraglide/runtime';
import { Runner } from './runner';

document.documentElement.lang = getLocale();
document.title = m.app_name();

// The theme follows the system's (design/frontend.md#preferences).
const dark = window.matchMedia('(prefers-color-scheme: dark)');
const applyTheme = () => document.documentElement.classList.toggle('dark', dark.matches);
applyTheme();
dark.addEventListener('change', applyTheme);

// One Worker per tab, created as the page loads (design/architecture.md#components).
const runner = new Runner(
  () => new Worker(new URL('./worker/entry.ts', import.meta.url), { type: 'module' }),
);

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App runner={runner} />
  </StrictMode>,
);
