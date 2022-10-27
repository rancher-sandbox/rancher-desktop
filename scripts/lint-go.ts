/**
 * This script runs gofmt for CI.
 *
 * The wrapper is needed because `gofmt -d` never exits with an error.
 * https://github.com/golang/go/issues/46289
 */

import { spawnFile } from '../pkg/rancher-desktop/utils/childProcess';

(async() => {
  const { stdout } = await spawnFile('gofmt', ['-d', 'pkg/rancher-desktop/go'], { stdio: ['ignore', 'pipe', 'inherit'] });

  if (!stdout) {
    return;
  }

  console.log(stdout);
  process.exit(1);
})();
