import { ChildProcess, spawn } from 'child_process';

export class Steve {
  private static instance: Steve;
  private process!: ChildProcess;

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

    const { stdout, stderr } = this.process;

    if (!stdout || !stderr) {
      console.error('Unable to get child process...');

      return;
    }

    stdout.on('data', (data: any) => {
      console.log(`stdout: ${ data }`);
    });

    stderr.on('data', (data: any) => {
      console.error(`stderr: ${ data }`);
    });

    this.process.on('close', (code: any) => {
      console.log(`child process exited with code ${ code }`);
    });

    console.debug(`Spawned child pid: ${ this.process.pid }`);
  }

  public stop() {
    this.process.kill();
  }
}
