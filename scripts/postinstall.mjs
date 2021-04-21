import { execFileSync } from 'child_process';
import os from 'os';

import('./download-resources.mjs');

switch (os.platform()) {
case 'darwin':
  import('./hyperkit.mjs');
  break;
}

execFileSync('node', ['node_modules/electron-builder/out/cli/cli.js', 'install-app-deps'], { stdio: 'inherit' });
