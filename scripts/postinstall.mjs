import { execFileSync } from 'child_process';
import os from 'os';

import('./download-resources.mjs').then(x => x.default()).then(() => {
  switch (os.platform()) {
  case 'darwin':
    return import('./hyperkit.mjs');
  default:
    return { default: () => {} };
  }
}).then(x => x.default()
).then(() => {
  execFileSync('node', ['node_modules/electron-builder/out/cli/cli.js', 'install-app-deps'], { stdio: 'inherit' });
})
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
