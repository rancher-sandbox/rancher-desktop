import { execFileSync } from 'child_process';
import os from 'os';

async function runScripts() {
  const scripts = ['download-resources'];

  switch (os.platform()) {
  case 'darwin':
    scripts.push('hyperkit', 'lima');
    break;
  case 'win32':
    scripts.push('wsl');
    break;
  }
  for (const script of scripts) {
    await (await import(`./${ script }.mjs`)).default();
  }
}

runScripts().then(() => {
  execFileSync('node', ['node_modules/electron-builder/out/cli/cli.js', 'install-app-deps'], { stdio: 'inherit' });
})
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
