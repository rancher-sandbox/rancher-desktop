import { spawn } from 'child_process';

export const start = () => {
  const steve: any = spawn(
    './resources/linux/bin/steve',
    [
      '--context',
      'rancher-desktop'
    ]
  );

  steve.stdout.on('data', (data: any) => {
    console.log(`stdout: ${ data }`);
  });

  steve.stderr.on('data', (data: any) => {
    console.error(`stderr: ${ data }`);
  });

  steve.on('close', (code: any) => {
    console.log(`child process exited with code ${ code }`);
  });
};
