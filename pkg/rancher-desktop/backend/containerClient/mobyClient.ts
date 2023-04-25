import fs from 'fs';
import os from 'os';
import path from 'path';

import _ from 'lodash';

import {
  ContainerComposeExecOptions, ReadableProcess, ContainerComposeOptions,
  ContainerEngineClient, ContainerRunOptions, ContainerStopOptions,
  ContainerRunClientOptions, ContainerComposePortOptions,
} from './types';

import { VMExecutor } from '@pkg/backend/backend';
import { ErrorCommand, spawn, spawnFile } from '@pkg/utils/childProcess';
import Logging, { Log } from '@pkg/utils/logging';
import paths from '@pkg/utils/paths';
import { executable } from '@pkg/utils/resources';
import { defined } from '@pkg/utils/typeUtils';

const console = Logging.moby;

export class MobyClient implements ContainerEngineClient {
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
  protected docker(...args: string[]): Promise<{ stdout: string, stderr: string }>;
  protected docker(options: {env?: Record<string, string>}, ...args: string[]): Promise<{ stdout: string, stderr: string }>;
  protected docker(argOrOptions: any, ...args: string[]): Promise<{ stdout: string, stderr: string }> {
    if (typeof argOrOptions === 'string') {
      return this.runTool('docker', argOrOptions, ...args);
    }

    return this.runTool(argOrOptions, 'docker', ...args);
  }

  protected async runTool(tool: string, ...args: string[]): Promise<{ stdout: string, stderr: string }>;
  protected async runTool(options: {env?: Record<string, string>}, tool: string, ...args: string[]): Promise<{ stdout: string, stderr: string }>;
  protected async runTool(argOrOptions: any, tool: string, ...args: string[]): Promise<{ stdout: string, stderr: string }> {
    const finalArgs = args.concat();
    const binDir = path.join(paths.resources, process.platform, 'bin');
    const options: { env: Record<string, string> } = {
      env: {
        DOCKER_HOST: this.endpoint,
        PATH:        `${ process.env.PATH }${ path.delimiter }${ binDir }`,
      },
    };

    if (typeof argOrOptions === 'string') {
      finalArgs.unshift(tool);
      tool = argOrOptions;
    } else {
      options.env = _.merge({}, argOrOptions?.env ?? {}, options.env);
    }

    return await spawnFile(executable(tool), finalArgs, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
  }

  protected async makeContainer(imageID: string): Promise<string> {
    const { stdout, stderr } = await this.docker('create', '--entrypoint=/', imageID);
    const container = stdout.trim();

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

    if (sourcePath.endsWith('/')) {
      // If we're copying a directory, add "." so we don't create an extra
      // directory.
      sourcePath += '.';
    }
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
      const { stdout, stderr } = (await this.docker(...args));

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
      const { stderr } = await this.docker('container', 'rm', '--force', container);

      if (!/Error: No such container: \S+/.test(stderr)) {
        console.debug(stderr.trim());
      }

      return;
    }

    await this.docker('container', 'stop', container);
    if (options?.delete) {
      await this.docker('container', 'rm', container);
    }
  }

  async composeUp(options: ContainerComposeOptions): Promise<void> {
    const args = ['--project-directory', options.composeDir];

    if (options.name) {
      args.push('--project-name', options.name);
    }
    args.push('up', '--quiet-pull', '--wait', '--remove-orphans');

    const result = await this.runTool({ env: options.env ?? {} }, 'docker-compose', ...args);

    console.debug('ran docker compose up', result);
  }

  async composeDown(options: ContainerComposeOptions): Promise<void> {
    const args = [
      options.name ? ['--project-name', options.name] : [],
      ['--project-directory', options.composeDir, 'down'],
    ].flat();
    const result = await this.runTool({ env: options.env ?? {} }, 'docker-compose', ...args);

    console.debug('ran docker compose down', result);
  }

  composeExec(options: ContainerComposeExecOptions): Promise<ReadableProcess> {
    const args = [
      options.name ? ['--project-name', options.name] : [],
      ['--project-directory', options.composeDir, 'exec'],
      options.user ? ['--user', options.user] : [],
      options.workdir ? ['--workdir', options.workdir] : [],
      [options.service, ...options.command],
    ].flat();

    return Promise.resolve(spawn(executable('docker-compose'), args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env:   {
        ...process.env,
        DOCKER_HOST: this.endpoint,
      },
    }));
  }

  async composePort(options: ContainerComposePortOptions): Promise<string> {
    const args = [
      options.name ? ['--project-name', options.name] : [],
      ['--project-directory', options.composeDir, 'port'],
      options.protocol ? ['--protocol', options.protocol] : [],
      [options.service, options.port.toString()],
    ].flat();
    const { stdout } = await this.runTool('docker-compose', ...args);

    return stdout.trim();
  }

  runClient(args: string[], stdio?: 'ignore', options?: ContainerRunClientOptions): Promise<Record<string, never>>;
  runClient(args: string[], stdio: Log, options?: ContainerRunClientOptions): Promise<Record<string, never>>;
  runClient(args: string[], stdio: 'pipe', options?: ContainerRunClientOptions): Promise<{ stdout: string; stderr: string; }>;
  runClient(args: string[], stdio: 'stream', options?: ContainerRunClientOptions): ReadableProcess;
  runClient(args: string[], stdio?: 'ignore' | 'pipe' | 'stream' | Log, options?: ContainerRunClientOptions) {
    const opts = options ?? {};

    // Due to TypeScript reasons, we have to make each branch separately.
    switch (stdio) {
    case 'ignore':
    case undefined:
      return spawnFile(this.executable, args, { ...opts, stdio: 'ignore' });
    case 'stream':
      return spawn(this.executable, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
    case 'pipe':
      return spawnFile(this.executable, args, { ...opts, stdio: 'pipe' });
    }

    return spawnFile(this.executable, args, { ...opts, stdio });
  }
}
