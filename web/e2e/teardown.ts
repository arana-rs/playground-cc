// After the end-to-end tests: removes their container and network, so nothing keeps the port.
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
