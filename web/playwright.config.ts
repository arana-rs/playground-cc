// The end-to-end tests: Chromium against the production build, served by the Compose file's
// static-web-server with its configuration, headers included (design/testing.md#end-to-end-tests).
import { defineConfig, devices } from '@playwright/test';

/** A port of its own, on the loopback only, so the tests never collide with a running site. */
const PORT = 4180;

export default defineConfig({
  testDir: './e2e',
  globalTeardown: './e2e/teardown.ts',
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // The build comes first (the `e2e` script); this serves it as a deploy does.
    command: 'docker compose -f ../deploy/compose.yaml -p playground-cc-e2e up',
    env: { PLAYGROUND_HOST_IP: '127.0.0.1', PLAYGROUND_PORT: String(PORT) },
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: false,
    timeout: 60_000,
    // Interrupted like Ctrl+C, `docker compose up` stops its container.
    gracefulShutdown: { signal: 'SIGINT', timeout: 10_000 },
  },
});
