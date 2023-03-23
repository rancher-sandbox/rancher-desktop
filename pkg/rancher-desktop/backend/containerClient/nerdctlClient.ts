import fs from 'fs';
import os from 'os';
import path from 'path';
import stream from 'stream';
import util from 'util';

import _ from 'lodash';
import tar from 'tar-stream';

import { ContainerComposeOptions, ContainerEngineClient, ContainerRunOptions, ContainerStopOptions } from './types';

import { VMExecutor } from '@pkg/backend/backend';
import { spawnFile } from '@pkg/utils/childProcess';
import Logging from '@pkg/utils/logging';
import { executable } from '@pkg/utils/resources';
import { defined } from '@pkg/utils/typeUtils';

const console = Logging.nerdctl;

/**
 * NerdctlClient manages nerdctl/containerd.
 */
export class NerdctlClient implements ContainerEngineClient {
  constructor(vm: VMExecutor) {
    this.vm = vm;
  }

  /** The VM backing Rancher Desktop */
  vm: VMExecutor;
  readonly executable = executable('nerdctl');

  /**
   * Run nerdctl with the given arguments, returning the standard output.
   */
  protected async nerdctl(...args: string[]): Promise<string>;
  protected async nerdctl(options: { env?: Record<string, string>}, ...args: string[]): Promise<string>;
  protected async nerdctl(optionOrArg: any, ...args: string[]): Promise<string> {
    const finalArgs = args.concat();
    const options: { env?: Record<string, string> } = {};

    if (typeof optionOrArg === 'string') {
      finalArgs.unshift(optionOrArg);
    } else {
      _.merge(options, { env: { ...process.env, ...optionOrArg.env } });
    }

    const { stdout } = await spawnFile(
      executable('nerdctl'),
      finalArgs,
      { stdio: ['ignore', 'pipe', console], ...options },
    );

    return stdout;
  }

  /**
   * Run a list of cleanup functions in reverse.
   */
  protected async runCleanups(cleanups: (() => Promise<void>)[]) {
    for (const cleanup of cleanups.reverse()) {
      try {
        await cleanup();
      } catch (e) {
        console.error('Failed to run cleanup:', e);
      }
    }
  }

  /**
   * Mount the given image inside the VM.
   * @param imageID The ID of the image to mount.
   * @returns The path that the image has been mounted on, plus an array of
   * cleanup functions that must be called in reverse order when done.
   * @note Due to https://github.com/containerd/nerdctl/issues/1058 we can't
   * just do `nerdctl create` + `nerdctl cp`.  Instead, we need to make mounts
   * manually.
   */
  protected async mountImage(imageID: string, namespace?: string): Promise<[string, (() => Promise<void>)[]]> {
    const cleanups: (() => Promise<void>)[] = [];

    try {
      const namespaceArgs = namespace === undefined ? [] : ['--namespace', namespace];
      const container = (await this.vm.execCommand({ capture: true },
        '/usr/local/bin/nerdctl', ...namespaceArgs, 'create', '--entrypoint=/', imageID)).trim();

      if (!container) {
        throw new Error(`Failed to create container for ${ imageID }`);
      }
      cleanups.push(() => this.vm.execCommand(
        '/usr/local/bin/nerdctl', ...namespaceArgs, 'rm', '--force', '--volumes', container));

      const workdir = (await this.vm.execCommand({ capture: true }, '/bin/mktemp', '-d', '-t', 'rd-nerdctl-cp-XXXXXX')).trim();

      cleanups.push(() => this.vm.execCommand('/bin/rm', '-rf', workdir));

      const command = await this.vm.execCommand({ capture: true, root: true },
        '/usr/bin/ctr', ...namespaceArgs,
        '--address=/run/k3s/containerd/containerd.sock', 'snapshot', 'mounts', workdir, container);

      await this.vm.execCommand({ root: true }, ...command.trim().split(' '));
      cleanups.push(async() => {
        try {
          await this.vm.execCommand({ root: true }, '/bin/umount', workdir);
        } catch (ex) {
          // Unmount might fail due to being busy; just detach and let it go
          // away by itself later.
          await this.vm.execCommand({ root: true }, '/bin/umount', '-l', workdir);
        }
      });

      return [workdir, cleanups];
    } catch (ex) {
      await this.runCleanups(cleanups);
      throw ex;
    }
  }

  readFile(imageID: string, filePath: string): Promise<string>;
  readFile(imageID: string, filePath: string, options: { encoding?: BufferEncoding, namespace?: string }): Promise<string>;
  async readFile(imageID: string, filePath: string, options?: { encoding?: BufferEncoding, namespace?: string }): Promise<string> {
    const encoding = options?.encoding ?? 'utf-8';
    const [workdir, cleanups] = await this.mountImage(imageID, options?.namespace);

    try {
      // The await here is needed to ensure we read the result before running
      // any cleanups
      return await this.vm.readFile(path.posix.join(workdir, filePath), { encoding });
    } finally {
      await this.runCleanups(cleanups);
    }
  }

  copyFile(imageID: string, sourcePath: string, destinationDir: string): Promise<void>;
  copyFile(imageID: string, sourcePath: string, destinationDir: string, options: { resolveSymlinks: false, namespace?: string }): Promise<void>;
  async copyFile(imageID: string, sourcePath: string, destinationDir: string, options?: { resolveSymlinks?: boolean, namespace?: string }): Promise<void> {
    const resolveSymlinks = options?.resolveSymlinks !== false;
    const [imageDir, cleanups] = await this.mountImage(imageID, options?.namespace);

    try {
      // Archive the file(s) into the VM
      const archive = (await this.vm.execCommand({ capture: true }, '/bin/mktemp', '-t', 'rd-nerdctl-cp-XXXXXX')).trim();

      cleanups.push(() => this.vm.execCommand('/bin/rm', '-f', archive));
      let sourceName: string, sourceDir: string;

      if (sourcePath.endsWith('/')) {
        sourceName = '.';
        sourceDir = path.posix.join(imageDir, sourcePath);
      } else {
        sourceName = path.posix.basename(sourcePath);
        sourceDir = path.posix.join(imageDir, path.posix.dirname(sourcePath));
      }
      const args = ['--create', '--gzip', '--file', archive, '--directory', sourceDir, resolveSymlinks ? '--dereference' : undefined, sourceName].filter(defined);

      await this.vm.execCommand('/usr/bin/tar', ...args);

      // Copy the archive to the host
      const workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'rd-nerdctl-copy-'));

      cleanups.push(() => fs.promises.rm(workDir, { recursive: true }));
      const hostArchive = path.join(workDir, 'copy-file.tgz');

      await this.vm.copyFileOut(archive, hostArchive);

      // Extract the archive into the destination.
      // Note that on Windows, we need to use the system-provided tar to handle Windows paths.
      const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot ?? `C:\\Windows`, 'system32', 'tar.exe') : '/usr/bin/tar';
      const extractArgs = ['xzf', hostArchive, '-C', destinationDir];

      await spawnFile(tar, extractArgs, { stdio: console });
    } finally {
      await this.runCleanups(cleanups);
    }
  }

  async run(imageID: string, options?: ContainerRunOptions): Promise<string> {
    const args = ['container', 'run', '--detach'];

    args.push('--restart', options?.restart === 'always' ? 'always' : 'no');
    if (options?.name) {
      args.push('--name', options.name);
    }
    if (options?.namespace) {
      args.unshift('--namespace', options.namespace);
    }
    args.push(imageID);

    return (await this.nerdctl(...args)).trim();
  }

  async composeUp(composeDir: string, options?: ContainerComposeOptions) {
    const cleanups: (() => Promise<void>)[] = [];

    try {
      const workDir = (await this.vm.execCommand({ capture: true },
        '/bin/mktemp', '--directory', '--tmpdir', 'rd-nerdctl-compose-up-XXXXXX')).trim();

      cleanups.push(() => this.vm.execCommand('/bin/rm', '-rf', workDir));

      const hostDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'rd-nerdctl-compose-up-'));

      cleanups.push(() => fs.promises.rm(hostDir, { recursive: true }));

      const hostPath = path.join(hostDir, 'compose.tar');
      const tarStream = fs.createWriteStream(hostPath);
      const archive = tar.pack();
      const archiveFinished = util.promisify(stream.finished)(archive);
      const newEntry = util.promisify(archive.entry.bind(archive));
      const baseHeader: Partial<tar.Headers> = {
        mode:  0o755,
        uid:   0,
        uname: 'root',
        gname: 'wheel',
        type:  'directory',
      };
      const walk = async(dir: string) => {
        const fullPath = path.normalize(path.join(composeDir, dir));

        for (const basename of await fs.promises.readdir(fullPath)) {
          const name = path.normalize(path.join(dir, basename));
          const info = await fs.promises.lstat(path.join(fullPath, basename));

          if (info.isDirectory()) {
            await newEntry({ ...baseHeader, name });
            await walk(path.join(dir, basename));
          } else if (info.isFile()) {
            const readStream = fs.createReadStream(path.join(fullPath, basename));
            const entry = archive.entry({
              ...baseHeader,
              ..._.pick(info, 'mode', 'mtime', 'size'),
              type: 'file',
              name,
            });
            const entryFinished = util.promisify(stream.finished)(entry);

            readStream.pipe(entry);
            await entryFinished;
          } else if (info.isSymbolicLink()) {
            await newEntry({
              ...baseHeader,
              ..._.pick(info, 'mode', 'mtime'),
              name,
              type:     'symlink',
              linkname: await fs.promises.readlink(path.join(fullPath, basename)),
            });
          }
        }
      };

      archive.pipe(tarStream);
      await walk('.');
      archive.finalize();
      await archiveFinished;

      await this.vm.copyFileIn(hostPath, path.posix.join(workDir, 'compose.tar'));
      await this.vm.execCommand('/bin/mkdir', path.posix.join(workDir, 'extract'));
      await this.vm.execCommand('/usr/bin/tar', 'xf', path.posix.join(workDir, 'compose.tar'), '-C', path.posix.join(workDir, 'extract'));

      const args = ['compose', '--project-directory', path.posix.join(workDir, 'extract')];

      if (options?.name) {
        args.push('--project-name', options.name);
      }
      if (options?.namespace) {
        args.unshift('--namespace', options.namespace);
      }
      if (options?.env) {
        const envFile = path.join(hostDir, 'compose.env');
        const envData = Object.entries(options.env)
          .map(([k, v]) => `${ k }='${ v.replaceAll("'", "\\'") }'\n`)
          .join('');

        await fs.promises.writeFile(envFile, envData);
        args.push('--env-file', envFile);
      }
      // nerdctl doesn't support --wait, so make do with --detach.
      args.push('up', '--quiet-pull', '--detach');

      const result = await this.nerdctl({ env: options?.env ?? {} }, ...args);

      console.log('ran nerdctl compose up', result);
    } finally {
      await this.runCleanups(cleanups);
    }
  }

  async stop(container: string, options?: ContainerStopOptions): Promise<void> {
    function addNS(...args: string[]) {
      if (options?.namespace) {
        return [`--namespace=${ options.namespace }`, ...args];
      }

      return args;
    }

    if (options?.delete && options.force) {
      await this.nerdctl(...addNS('container', 'rm', '--force', container));

      return;
    }

    await this.nerdctl(...addNS('container', 'stop', container));
    if (options?.delete) {
      await this.nerdctl(...addNS('container', 'rm', container));
    }
  }

  async composeDown(composeDir: string, options?: ContainerComposeOptions): Promise<void> {
    const cleanups: (() => Promise<void>)[] = [];
    const args = [
      options?.namespace ? ['--namespace', options.namespace] : [],
      ['compose'],
      options?.name ? ['--project-name', options.name] : [],
      ['--project-directory', composeDir, 'down'],
    ].flat();

    try {
      if (options?.env) {
        const envDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'rd-nerdctl-compose-up-env-'));
        const envFile = path.join(envDir, 'compose.env');
        const envData = Object.entries(options.env)
          .map(([k, v]) => `${ k }='${ v.replaceAll("'", "\\'") }'\n`)
          .join('');

        cleanups.push(() => fs.promises.rm(envDir, { recursive: true }));
        await fs.promises.writeFile(envFile, envData);
        args.push('--env-file', envFile);
      }
      const result = await this.nerdctl(...args);

      console.debug('ran nerdctl compose down:', result);
    } finally {
      await this.runCleanups(cleanups);
    }
  }
}
