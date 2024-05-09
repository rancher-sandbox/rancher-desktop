import fs from 'fs';
import os from 'os';
import path from 'path';
import stream from 'stream';
import util from 'util';

import _ from 'lodash';
import tar from 'tar-stream';

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
      await fs.promises.rm(workDir, { recursive: true, maxRetries: 3 });
    }
  }

  copyFile(imageID: string, sourcePath: string, destinationPath: string): Promise<void>;
  copyFile(imageID: string, sourcePath: string, destinationPath: string, options: { silent?: true }): Promise<void>;
  async copyFile(imageID: string, sourcePath: string, destinationPath: string, options?: { silent?: boolean }): Promise<void> {
    const cleanups: (() => Promise<unknown>)[] = [];

    if (!options?.silent) {
      console.debug(`Copying ${ imageID }:${ sourcePath } to ${ destinationPath }`);
    }

    const container = await this.makeContainer(imageID);

    cleanups.push(() => this.runClient(['rm', container], console));

    try {
      if (this.vm.backend === 'wsl') {
        // On Windows, non-Administrators by default do not have the privileges
        // to create symlinks.  However, `docker cp --follow-link` doesn't
        // dereference symlinks it encounters when recursively copying a file.
        // We work around this by copying it into a tarball in the VM and then
        // extracting it from there.
        const workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'rd-moby-cp-'));

        cleanups.push(() => fs.promises.rm(workDir, {
          recursive: true, force: true, maxRetries: 3,
        }));
        const archive = path.join(workDir, 'archive.tar');
        const wslArchive = (await this.vm.execCommand({ capture: true }, '/bin/wslpath', '-u', archive)).trim();

        await this.vm.execCommand(
          '/bin/sh', '-c',
          `/usr/bin/docker cp '${ container }:${ sourcePath }' - > '${ wslArchive }'`);
        if (sourcePath.endsWith('/')) {
          await this.extractArchive(archive, destinationPath, sourcePath);
        } else {
          // If we only archived a single file, there is no prefix in the archive.
          await this.extractArchive(archive, destinationPath);
        }
      } else {
        if (sourcePath.endsWith('/')) {
          // If we're copying a directory, add "." so we don't create an extra
          // directory.
          sourcePath += '.';
        }
        await this.runClient(
          ['cp', '--follow-link', `${ container }:${ sourcePath }`, destinationPath],
          console);
      }
    } finally {
      await this.runCleanups(cleanups);
    }
  }

  /**
   * Extract the given archive into the given directory, dereferencing symbolic
   * links (because they are not supported on Windows).
   * @param archive The archive to extract, as a host path.
   * @param destination The destination directory, as a host path.
   * @param stripPrefix A prefix to strip from the file path.
   */
  protected async extractArchive(archive: string, destination: string, stripPrefix = ''): Promise<void> {
    const stripPrefixWithoutSlash = stripPrefix.replace(/^\/+/, '');
    // Because tar is a streaming format, we need to go over it twice: first, to
    // extract the non-linked files, and to collect all links; then again, to
    // extract any files that were pointed to by links.
    const links: Record<string, string> = {};

    // Convert a given path to an absolute path, ensuring that it resides
    // within the destination.  If the name does not start with the prefix to be
    // stripped, returns `undefined` and this entry should not be processed.
    const absPath = (rawPath: string): string | undefined => {
      let mungedPath = rawPath;

      if (stripPrefix) {
        if (mungedPath.startsWith(stripPrefixWithoutSlash)) {
          mungedPath = mungedPath.substring(stripPrefixWithoutSlash.length);
        } else {
          // A prefix is given, but we found a file that doesn't match; we
          // should skip this file.
          return;
        }
      }
      const normalized = path.normalize(path.join(destination, mungedPath));

      if (/[/\\]\.\.[/\\]/.test(path.relative(destination, normalized))) {
        throw new Error(`Error extracting archive: ${ normalized } is not in ${ destination }`);
      }

      return normalized;
    };

    for await (const entry of fs.createReadStream(archive).pipe(tar.extract())) {
      switch (entry.header.type) {
      case 'link': case 'symlink': {
        const linkName = entry.header.name;
        const realName = entry.header.linkname;

        if (!realName) {
          throw new Error(`Error extracting archive: ${ linkName } has no destination`);
        }
        if (realName.startsWith('/')) {
          links[linkName] = realName;
        } else {
          links[linkName] = path.posix.join(path.posix.dirname(entry.header.name), realName);
        }
        break;
      }
      case 'directory': {
        const dirName = absPath(entry.header.name);

        if (!dirName) {
          console.warn(`Skipping unexpected directory ${ entry.header.name }`);
          continue;
        }
        await fs.promises.mkdir(dirName, { recursive: true });
        console.debug(`Created directory ${ dirName }`);

        break;
      }
      case 'file': case 'contiguous-file': {
        const fileName = absPath(entry.header.name);

        if (!fileName) {
          console.warn(`Skipping unexpected file ${ entry.header.name }`);
          continue;
        }
        await fs.promises.mkdir(path.dirname(fileName), { recursive: true });
        await stream.promises.finished(entry.pipe(fs.createWriteStream(fileName)));
        console.debug(`Wrote ${ fileName }`);

        break;
      }
      default:
        console.info(`Ignoring unsupported file type ${ entry.header.name } (${ entry.header.type })`);
      }
    }

    /**
     * Mapping from link destination to the link name.
     * @note There can be multiple links pointing to the same file.
     */
    const reverseLinks: Record<string, string[]> = {};

    for (const linkName in links) {
      while (links[links[linkName]]) {
        // The link points to another link; flatten it.
        links[linkName] = links[links[linkName]];
      }

      reverseLinks[links[linkName]] ||= [];
      reverseLinks[links[linkName]].push(linkName);
    }

    for await (const entry of fs.createReadStream(archive).pipe(tar.extract())) {
      const linkNames = reverseLinks[entry.header.name] ?? [];

      if (linkNames.length === 0) {
        // This entry isn't a link target
        continue;
      }
      switch (entry.header.type) {
      case 'directory':
        await Promise.all(linkNames.map(async(linkName) => {
          const dirName = absPath(linkName);

          if (!dirName) {
            console.warn(`Skipping unexpected directory ${ entry.header.name } -> ${ linkName }`);

            return;
          }
          await fs.promises.mkdir(dirName, { recursive: true });
          delete links[linkName];
          console.debug(`Created directory ${ dirName }`);
        }));
        break;
      case 'file': case 'contiguous-file': {
        await Promise.all(linkNames.map(async(linkName) => {
          const fileName = absPath(linkName);

          if (!fileName) {
            console.warn(`Skipping unexpected file ${ entry.header.name } -> ${ linkName }`);

            return;
          }
          await fs.promises.mkdir(path.dirname(fileName), { recursive: true });
          await stream.promises.finished(entry.pipe(fs.createWriteStream(fileName)));
          delete links[linkName];
          console.debug(`Wrote ${ fileName } from ${ entry.header.name }`);
        }));

        break;
      }
      default:
        console.info(`Ignoring unsupported file type ${ entry.header.name } (${ entry.header.type })`);
      }
    }

    // Handle symlinks that were not found
    for (const [linkName, linkTarget] of Object.entries(links)) {
      console.warn(`Skipping missing link ${ linkName } -> ${ linkTarget }`);
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

    return Promise.resolve(this.runClient(args, 'stream',
      { ...options, executable: 'docker-compose' }));
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
