// The smoke suite: a few flows only the real page can check, against the build as deployed
// (design/testing.md#end-to-end-tests). Every test fails on a CSP violation or a page error.
import { test as base, expect, type Page, type Worker } from '@playwright/test';

/** What the fixture adds to a Worker's global scope. */
interface WorkerScope {
  violations: string[];
  addEventListener(
    type: 'securitypolicyviolation',
    listener: (event: SecurityPolicyViolationEvent) => void,
  ): void;
}

const CSP =
  "default-src 'self'; script-src 'self'; worker-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; " +
  "form-action 'none'; frame-ancestors 'none'";

/** What the page reports that it must not: CSP violations, from the page or its Worker, and errors. */
const test = base.extend<{ problems: string[] }>({
  problems: [
    async ({ page }, use) => {
      const problems: string[] = [];
      page.on('console', (message) => {
        if (/Content Security Policy|Refused to/i.test(message.text())) {
          problems.push(message.text());
        }
      });
      page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
      // A Worker's violations fire in its own scope, which the page's listener does not see: each
      // Worker keeps its own, read at the end.
      const workers: Worker[] = [];
      page.on('worker', (worker) => {
        workers.push(worker);
        void worker
          .evaluate(() => {
            const scope = globalThis as unknown as WorkerScope;
            scope.violations = [];
            scope.addEventListener('securitypolicyviolation', (event) => {
              scope.violations.push(`${event.violatedDirective} ${event.blockedURI}`);
            });
          })
          .catch(() => {});
      });
      await page.addInitScript(() => {
        document.addEventListener('securitypolicyviolation', (event) => {
          console.error(
            `Content Security Policy violation: ${event.violatedDirective} ${event.blockedURI}`,
          );
        });
      });
      await use(problems);
      for (const worker of workers) {
        const found = await worker
          .evaluate(() => (globalThis as unknown as WorkerScope).violations ?? [])
          .catch(() => []);
        problems.push(...found.map((violation) => `worker: ${violation}`));
      }
      expect(problems).toEqual([]);
    },
    { auto: true },
  ],
});

/** Replaces the code in the editor. */
async function setCode(page: Page, code: string) {
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.insertText(code);
}

const consoleRegion = (page: Page) => page.getByRole('region', { name: 'Console' });

test.describe('the server', () => {
  test('sends the security headers on every response, 404s included', async ({ request }) => {
    for (const [path, status] of [
      ['/', 200],
      ['/missing', 404],
      ['/assets/', 404],
      ['/.hidden', 404],
    ] as const) {
      const response = await request.get(path);
      expect(response.status(), path).toBe(status);
      const headers = response.headers();
      expect(headers['content-security-policy'], path).toBe(CSP);
      expect(headers['x-content-type-options'], path).toBe('nosniff');
      expect(headers['referrer-policy'], path).toBe('no-referrer');
      expect(headers['cross-origin-opener-policy'], path).toBe('same-origin');
      expect(headers['cache-control'], path).toBe('no-cache');
    }
  });

  test('serves the licenses as plain text', async ({ request }) => {
    const license = await request.get('/LICENSE.txt');
    expect(license.headers()['content-type']).toBe('text/plain; charset=utf-8');
    expect(await license.text()).toContain('GNU AFFERO GENERAL PUBLIC LICENSE');
    const notices = await request.get('/THIRD-PARTY-LICENSES.txt');
    expect(notices.headers()['content-type']).toBe('text/plain; charset=utf-8');
    expect(await notices.text()).toMatch(/^playground-cc is licensed under/);
  });

  test("revalidates the build's files on every load", async ({ request }) => {
    const page = await (await request.get('/')).text();
    const script = page.match(/src="(\/assets\/[^"]+\.js)"/)?.[1];
    expect(script).toBeDefined();
    const response = await request.get(script as string);
    expect(response.headers()['cache-control']).toBe('no-cache');
    expect(response.headers()['last-modified']).toBeDefined();
  });
});

test.describe('the page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('runs hello world in the Worker', async ({ page }) => {
    await page.getByRole('button', { name: 'Run' }).click();
    await expect(consoleRegion(page)).toHaveText(/^Hello, world!\nProgram exited with status 0\.$/);
  });

  test('stops an infinite loop', async ({ page }) => {
    // The page's clock is the test's, so the second before Stop shows passes at once, and the
    // run cannot use up its steps first.
    await page.clock.install();
    await page.goto('/');
    await setCode(page, 'int main(void) {\nint i = 0;\nfor (;;) i = (i + 1) % 7;\n}\n');
    await page.getByRole('button', { name: 'Run' }).click();
    await expect(page.getByRole('button', { name: 'Run' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await page.clock.fastForward(1000);
    await page.getByRole('button', { name: 'Stop' }).click();
    await expect(consoleRegion(page)).toHaveText('Program stopped.');
    await expect(page.getByRole('button', { name: 'Run' })).toBeVisible();
  });

  test('shows a diagnostic in the console and its marker in the editor', async ({ page }) => {
    await setCode(page, 'int main(void) {\nint zero = 0;\nreturn 1 / zero;\n}\n');
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect(consoleRegion(page)).toContainText('Division by zero. line 3, column 8');
    await expect(page.locator('.cm-lintRange-error')).toHaveText('1 / zero');
  });

  test('opens the third-party licenses from the settings', async ({ page }) => {
    await page.getByRole('button', { name: 'Settings' }).click();
    const opened = page.waitForEvent('popup');
    await page.getByRole('link', { name: /^Licenses/ }).click();
    const licenses = await opened;
    await expect(licenses.locator('body')).toContainText('playground-cc is licensed under');
  });
});
