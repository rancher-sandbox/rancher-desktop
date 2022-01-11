import { spawn } from 'child_process';

export class Steve {
  private static instance: Steve;
  private process: any;

  private constructor() {
    this.start();
  }

  public static getInstance(): Steve {
    if (!Steve.instance) {
      Steve.instance = new Steve();
    }

    return Steve.instance;
  }

  start() {
    const { pid } = this.process || { };

    if (pid) {
      console.debug(`Steve has pid: ${ pid }`);

      return;
    }

    this.process = spawn(
      './resources/linux/bin/steve',
      [
        '--context',
        'rancher-desktop'
      ]
    );

    this.process.stdout.on('data', (data: any) => {
      console.log(`stdout: ${ data }`);
    });

    this.process.stderr.on('data', (data: any) => {
      console.error(`stderr: ${ data }`);
    });

    this.process.on('close', (code: any) => {
      console.log(`child process exited with code ${ code }`);
    });

    console.debug(`Spawned child pid: ${ this.process.pid }`);
  }

  stop() {
    this.process.kill();
  }
}
