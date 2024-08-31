import assert from 'assert';
import { exec } from 'child_process';
import { statSync } from 'fs';

import { exec as sudo } from './';

function kill(end) {
  if (process.platform === 'win32') {
    return end();
  }
  exec('sudo -k', end);
}

function icns() {
  if (process.platform !== 'darwin') {
    return undefined;
  }
  const path = '/Applications/Electron.app/Contents/Resources/Electron.icns';

  try {
    statSync(path);

    return path;
  } catch (error) {
  }

  return undefined;
}

kill(
  () => {
    const options = {
      env:  { SUDO_PROMPT_TEST_ENV: 'hello world' },
      icns: icns(),
      name: 'Electron',
    };

    let command;
    let expected;

    if (process.platform === 'win32') {
      command = 'echo %SUDO_PROMPT_TEST_ENV%';
      expected = 'hello world\r\n';
    } else {
      // We use double quotes to tell echo to preserve internal space:
      command = 'echo "$SUDO_PROMPT_TEST_ENV"';
      expected = 'hello world\n';
    }
    console.log(
      `sudo.exec(${
        JSON.stringify(command) }, ${
        JSON.stringify(options)
      })`,
    );
    sudo(command, options,
      (error, stdout, stderr) => {
        console.log('error:', error);
        console.log(`stdout: ${ JSON.stringify(stdout) }`);
        console.log(`stderr: ${ JSON.stringify(stderr) }`);
        assert(error === undefined || typeof error === 'object');
        assert(stdout === undefined || typeof stdout === 'string');
        assert(stderr === undefined || typeof stderr === 'string');
        kill(
          () => {
            if (error) {
              throw error;
            }
            if (stdout !== expected) {
              throw new Error(`stdout != ${ JSON.stringify(expected) }`);
            }
            if (stderr !== '') {
              throw new Error('stderr != ""');
            }
            console.log('OK');
          },
        );
      },
    );
  },
);
