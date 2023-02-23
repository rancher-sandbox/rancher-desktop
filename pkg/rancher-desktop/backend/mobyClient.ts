import fs from 'fs';
import os from 'os';
import path from 'path';

import { VMExecutor } from '@pkg/backend/backend';
import { ContainerEngineClient, ContainerRunOptions, ContainerStopOptions } from '@pkg/backend/containerEngine';
import { ErrorCommand, spawnFile } from '@pkg/utils/childProcess';
import Logging from '@pkg/utils/logging';
import { executable } from '@pkg/utils/resources';
import { defined } from '@pkg/utils/typeUtils';

const console = Logging.moby;

export default class MobyClient implements ContainerEngineClient {
  constructor(vm: VMExecutor, endpoint: string) {
    this.vm = vm;
    this.endpoint = endpoint;
  }

  readonly vm: VMExecutor;
  readonly executable = executable('docker');
  readonly endpoint: string;

  /**
   * Run docker (CLI) with the given arguments, returning stdout.
   * @param args
   * @returns
   */
  protected async runTool(...args: string[]): Promise<{ stdout: string, stderr: string }> {
    const { stdout, stderr } = await spawnFile(
      this.executable,
      args,
      { stdio: ['ignore', 'pipe', 'pipe'], env: { DOCKER_HOST: this.endpoint } });

    return { stdout, stderr };
  }

  protected async makeContainer(imageID: string): Promise<string> {
    const { stdout, stderr } = await this.runTool('create', '--entrypoint=/', imageID);
    const container = stdout.split(/\r?\n/).filter(x => x).pop()?.trim();

    console.debug(stderr.trim());
    if (!container) {
      throw new Error(`Failed to create container ${ imageID }`);
    }

    return container;
  }

  readFile(imageID: string, filePath: string): Promise<string>;
  readFile(imageID: string, filePath: string, options: { encoding?: BufferEncoding; }): Promise<string>;
  async readFile(imageID: string, filePath: string, options?: { encoding?: BufferEncoding }): Promise<string> {
    const encoding = options?.encoding ?? 'utf-8';

    console.debug(`Reading file ${ imageID }:${ filePath }`);

    const workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'rd-moby-readfile-'));
    const tempFile = path.join(workDir, path.basename(filePath));

    // `docker cp ... -` returns a tar file, which isn't what we want.  It's
    // easiest to just copy the file to disk and read it.
    try {
      await this.copyFile(imageID, filePath, workDir, { silent: true });

      return await fs.promises.readFile(tempFile, { encoding });
    } finally {
      await fs.promises.rm(workDir, { recursive: true });
    }
  }

  copyFile(imageID: string, sourcePath: string, destinationPath: string): Promise<void>;
  copyFile(imageID: string, sourcePath: string, destinationPath: string, options: { resolveSymlinks?: false; silent?: true }): Promise<void>;
  async copyFile(imageID: string, sourcePath: string, destinationPath: string, options?: { resolveSymlinks?: boolean, silent?: boolean }): Promise<void> {
    const resolveSymlinks = options?.resolveSymlinks !== false;

    if (!options?.silent) {
      console.debug(`Copying ${ imageID }:${ sourcePath } to ${ destinationPath }`);
    }

    const container = await this.makeContainer(imageID);

    try {
      const args = ['cp', resolveSymlinks ? '--follow-link' : undefined, `${ container }:${ sourcePath }`, destinationPath].filter(defined);

      await spawnFile(this.executable, args, { stdio: console });
    } finally {
      await spawnFile(this.executable, ['rm', container], { stdio: console });
    }
  }

  async run(imageID: string, options?: ContainerRunOptions): Promise<string> {
    const args = ['container', 'run', '--detach'];

    args.push('--restart', options?.restart === 'always' ? 'always' : 'no');
    if (options?.name) {
      args.push('--name', options.name);
    }
    args.push(imageID);

    try {
      const { stdout, stderr } = (await this.runTool(...args));

      console.debug(stderr.trim());

      return stdout.trim();
    } catch (ex: any) {
      if (Object.prototype.hasOwnProperty.call(ex, ErrorCommand)) {
        const match = /container name "[^"]*" is already in use by container "(?<id>[0-9a-f]+)"./.exec(ex.stderr ?? '');
        const result = match?.groups?.['id'];

        if (result) {
          return result;
        }
      }
      throw ex;
    }
  }

  async stop(container: string, options?: ContainerStopOptions): Promise<void> {
    if (options?.delete && options.force) {
      const { stderr } = await this.runTool('container', 'rm', '--force', container);

      if (!/Error: No such container: \S+/.test(stderr)) {
        console.debug(stderr.trim());
      }

      return;
    }

    await this.runTool('container', 'stop', container);
    if (options?.delete) {
      await this.runTool('container', 'rm', container);
    }
  }
}
