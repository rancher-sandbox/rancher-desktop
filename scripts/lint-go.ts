/**
 * This script runs gofmt for CI.
 *
 * The wrapper is needed because `gofmt -d` never exits with an error.
 * https://github.com/golang/go/issues/46289
 */
import { execFileSync } from 'child_process';

const stdout = execFileSync('gofmt', ['-d', 'src/go']).toString();

if (stdout) {
  console.log(stdout);
  process.exit(1);
}

