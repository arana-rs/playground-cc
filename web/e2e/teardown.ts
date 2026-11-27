// Before and after the end-to-end tests: removes their container and network, so nothing keeps
// the port.
import { execFileSync } from 'node:child_process';

export default function teardown(): void {
  execFileSync(
    'docker',
    [
      'compose',
      '-f',
      '../deploy/compose.yaml',
      '-p',
      'playground-cc-e2e',
      'down',
      '--remove-orphans',
    ],
    { stdio: 'ignore' },
  );
}

// Run directly (the `e2e` script, before the tests), it cleans up what an earlier run left.
if (import.meta.main) teardown();
