// Before each test file: jsdom's missing `matchMedia`; after each test, no stored preferences.
import { afterEach } from 'vitest';
import { forgetChoices } from '../src/preferences';
import { installMedia, resetMedia } from './media';

if (typeof window !== 'undefined') {
  installMedia();
  afterEach(() => {
    localStorage.clear();
    resetMedia();
    document.documentElement.classList.remove('dark');
  });
}
afterEach(() => forgetChoices());
