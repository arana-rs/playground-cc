import './index.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// The language and theme preferences come first: Paraglide asks them for the language.
import './preferences';
import { App } from './App';
import { Runner } from './runner';

// One Worker per tab, created as the page loads (design/architecture.md#components).
const runner = new Runner(
  () => new Worker(new URL('./worker/entry.ts', import.meta.url), { type: 'module' }),
);

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App runner={runner} />
  </StrictMode>,
);
