import fs from 'fs';
import os from 'os';
import path from 'path';
import util from 'util';

import _ from 'lodash';

import {
  ContainerComposeExecOptions, ReadableProcess, ContainerComposeOptions,
  ContainerEngineClient, ContainerRunOptions, ContainerStopOptions,
  ContainerRunClientOptions, ContainerComposePortOptions, ContainerBasicOptions,
} from './types';

import { VMExecutor } from '@pkg/backend/backend';
import dockerRegistry from '@pkg/backend/containerClient/registry';
import { ErrorCommand, spawn, spawnFile } from '@pkg/utils/childProcess';
import { parseImageReference } from '@pkg/utils/dockerUtils';
import Logging, { Log } from '@pkg/utils/logging';
import paths from '@pkg/utils/paths';
import { executable } from '@pkg/utils/resources';

const console = Logging.moby;

type runClientOptions = ContainerRunClientOptions & {
  /** The executable to run, defaulting to this.executable (i.e. "docker") */
  executable?: string;
};

export class MobyClient implements ContainerEngineClient {
  constructor(vm: VMExecutor, endpoint: string) {
    this.vm = vm;
    this.endpoint = endpoint;
  }

  readonly vm: VMExecutor;
  readonly executable = executable('docker');
  readonly endpoint: string;

  /**
   * Run a list of cleanup functions in reverse.
   */
  protected async runCleanups(cleanups: (() => Promise<unknown>)[]) {
    for (const cleanup of cleanups.reverse()) {
      try {
        await cleanup();
      } catch (e) {
        console.error('Failed to run cleanup:', e);
      }
    }
  }

  protected async makeContainer(imageID: string): Promise<string> {
    const { stdout, stderr } = await this.runClient(['create', '--entrypoint=/', imageID], 'pipe');
    const container = stdout.trim();

    console.debug(stderr.trim());
    if (!container) {
      throw new Error(`Failed to create container ${ imageID }`);
    }

    return container;
  }

  async waitForReady(): Promise<void> {
    let successCount = 0;

    // Wait for ten consecutive successes, clearing out successCount whenever we
    // hit an error.  In the ideal case this is a ten-second delay in startup
    // time.  We use `docker system info` because that needs to talk to the
    // socket to fetch data about the engine (and it returns an error if it
    // fails to do so).
    while (successCount < 10) {
      try {
        await this.runClient(['system', 'info'], 'ignore');
        successCount++;
      } catch (ex) {
        successCount = 0;
      }
      await util.promisify(setTimeout)(1_000);
    }
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
  copyFile(imageID: string, sourcePath: string, destinationPath: string, options: { silent?: true }): Promise<void>;
  async copyFile(imageID: string, sourcePath: string, destinationPath: string, options?: { silent?: boolean }): Promise<void> {
    const cleanups: (() => Promise<unknown>)[] = [];

    if (sourcePath.endsWith('/')) {
      // If we're copying a directory, add "." so we don't create an extra
      // directory.
      sourcePath += '.';
    }
    if (!options?.silent) {
      console.debug(`Copying ${ imageID }:${ sourcePath } to ${ destinationPath }`);
    }

    const container = await this.makeContainer(imageID);

    cleanups.push(() => spawnFile(this.executable, ['rm', container], { stdio: console }));

    try {
      if (this.vm.backend === 'wsl') {
        // On Windows, non-Administrators by default do not have the privileges
        // to create symlinks.  However, `docker cp --follow-link` doesn't
        // dereference symlinks it encounters when recursively copying a file.
        // We work around this by copying it into a tarball in the VM and then
        // extracting it from there.
        const wslDestPath = (await this.vm.execCommand({ capture: true }, '/bin/wslpath', '-u', destinationPath)).trim();
        const archive = (await this.vm.execCommand({ capture: true }, '/bin/mktemp', '-t', 'rd-moby-cp-XXXXXX')).trim();

        cleanups.push(() => this.vm.execCommand('/bin/rm', '-f', archive));
        await this.vm.execCommand(
          '/bin/sh', '-c',
          `/usr/bin/docker cp '${ container }:${ sourcePath }' - > '${ archive }'`);
        await this.vm.execCommand(
          '/usr/bin/tar', '--extract', '--file', archive, '--dereference',
          '--directory', wslDestPath);
      } else {
        await spawnFile(
          this.executable,
          ['cp', '--follow-link', `${ container }:${ sourcePath }`, destinationPath],
          { stdio: console });
      }
    } finally {
      await this.runCleanups(cleanups);
    }
  }

  async getTags(imageName: string, options?: ContainerBasicOptions) {
    let results = new Set<string>();

    try {
      results = new Set(await dockerRegistry.getTags(imageName));
    } catch (ex) {
      // We may fail here if the image doesn't exist / has an invalid host.
      console.debugE(`Could not get tags from registry for ${ imageName }, ignoring:`, ex);
    }

    try {
      const desired = parseImageReference(imageName);
      const { stdout } = await this.runClient(
        ['image', 'list', '--format={{ .Repository }}:{{ .Tag }}'], 'pipe', options);

      console.log(`existing images:`, stdout);
      for (const imageRef of stdout.split(/\s+/).filter(v => v)) {
        const info = parseImageReference(imageRef);

        if (info?.tag && info.equalName(desired)) {
          results.add(info.tag);
        }
      }
    } catch (ex) {
      // Failure to list images is acceptable.
      console.debugE(`Could not get tags of existing images for ${ imageName }, ignoring:`, ex);
    }

    return results;
  }

  async run(imageID: string, options?: ContainerRunOptions): Promise<string> {
    const args = ['container', 'run', '--detach'];

    args.push('--restart', options?.restart === 'always' ? 'always' : 'no');
    if (options?.name) {
      args.push('--name', options.name);
    }
    args.push(imageID);

    try {
      const { stdout, stderr } = await this.runClient(args, 'pipe');

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
      const { stderr } = await this.runClient(['container', 'rm', '--force', container], 'pipe');

      if (!/Error: No such container: \S+/.test(stderr)) {
        console.debug(stderr.trim());
      }

      return;
    }

    await this.runClient(['container', 'stop', container]);
    if (options?.delete) {
      await this.runClient(['container', 'rm', container]);
    }
  }

  async composeUp(options: ContainerComposeOptions): Promise<void> {
    const args = ['--project-directory', options.composeDir];

    if (options.name) {
      args.push('--project-name', options.name);
    }
    args.push('up', '--quiet-pull', '--wait', '--remove-orphans');

    await this.runClient(args, console, { ...options, executable: 'docker-compose' });
    console.debug('ran docker compose up');
  }

  async composeDown(options: ContainerComposeOptions): Promise<void> {
    const args = [
      options.name ? ['--project-name', options.name] : [],
      ['--project-directory', options.composeDir, 'down'],
    ].flat();

    await this.runClient(args, console, { ...options, executable: 'docker-compose' });
    console.debug('ran docker compose down');
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
    const { stdout } = await this.runClient(args, 'pipe', { ...options, executable: 'docker-compose' });

    return stdout.trim();
  }

  runClient(args: string[], stdio?: 'ignore', options?: runClientOptions): Promise<Record<string, never>>;
  runClient(args: string[], stdio: Log, options?: runClientOptions): Promise<Record<string, never>>;
  runClient(args: string[], stdio: 'pipe', options?: runClientOptions): Promise<{ stdout: string; stderr: string; }>;
  runClient(args: string[], stdio: 'stream', options?: runClientOptions): ReadableProcess;
  runClient(args: string[], stdio?: 'ignore' | 'pipe' | 'stream' | Log, options?: runClientOptions) {
    const binDir = path.join(paths.resources, process.platform, 'bin');
    const executable = path.resolve(binDir, options?.executable ?? this.executable);
    const opts = _.merge({}, options ?? {}, {
      env: {
        DOCKER_HOST: this.endpoint,
        PATH:        `${ process.env.PATH }${ path.delimiter }${ binDir }`,
      },
    });

    // Due to TypeScript reasons, we have to make each branch separately.
    switch (stdio) {
    case 'ignore':
    case undefined:
      return spawnFile(executable, args, { ...opts, stdio: 'ignore' });
    case 'stream':
      return spawn(executable, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
    case 'pipe':
      return spawnFile(executable, args, { ...opts, stdio: 'pipe' });
    }

    return spawnFile(executable, args, { ...opts, stdio });
  }
}
