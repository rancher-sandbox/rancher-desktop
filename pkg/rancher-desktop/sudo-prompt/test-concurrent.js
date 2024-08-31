import { exec } from 'child_process';

import { exec as sudo } from './';

function kill(end) {
  if (process.platform === 'win32') {
    return end();
  }
  exec('sudo -k', end);
}

kill(
  () => {
    const options = { name: 'Sudo Prompt' };

    let sleep;

    if (process.platform === 'win32') {
      sleep = 'timeout /t 10\r\necho world';
    } else {
      sleep = 'sleep 10 && echo world';
    }
    sudo(sleep, options,
      (error, stdout, stderr) => {
        console.log(error, stdout, stderr);
      },
    );
    sudo('echo hello', options,
      (error, stdout, stderr) => {
        console.log(error, stdout, stderr);
      },
    );
  },
);
