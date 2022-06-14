import childProcess from 'child_process';
import os from 'os';
import { copyFileSync, symlinkSync, unlink, unlinkSync } from 'fs';

function linkOrCopy(dest, link) {
  try {
    unlinkSync(link);
  } catch (e) {}

  try {
    symlinkSync(dest, link, 'file');
  } catch (e) {
    copyFileSync(dest, link);
  }
}

const args = ['install-app-deps'];

const file = (`${ os.platform }` === 'darwin' && os.release().split('.')[0] >= 20) ? 'electron-builder-darwin-m1.yml' : 'electron-builder-default.yml';

linkOrCopy(file, 'electron-builder.yml');

function runScript() {
  // keep track of whether callback has been invoked to prevent multiple invocations
  let invoked = false;

  const child = childProcess.fork('node_modules/.bin/electron-builder', args);

  // listen for errors as they may prevent the exit event from firing
  child.on('error', (err) => {
    if (invoked) {
      console.log('ignoring');

      return;
    }
    console.log(err);

    invoked = true;
    process.exit(1);
  });

  // execute the callback once the process has finished running
  child.on('exit', (code) => {
    if (invoked) {
      console.log('ignoring');

      return;
    }

    invoked = true;
    const err = code === 0 ? null : new Error(`exit code ${ code }`);

    process.exit(code);
  });
}

runScript();
