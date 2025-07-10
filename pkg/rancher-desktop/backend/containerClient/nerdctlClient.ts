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

import { execOptions, VMExecutor } from '@pkg/backend/backend';
import dockerRegistry from '@pkg/backend/containerClient/registry';
import { spawn, spawnFile } from '@pkg/utils/childProcess';
import { parseImageReference } from '@pkg/utils/dockerUtils';
import Logging, { Log } from '@pkg/utils/logging';
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
  readonly vm: VMExecutor;
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
  protected async runCleanups(cleanups: (() => Promise<unknown>)[]) {
    for (const cleanup of cleanups.reverse()) {
      try {
        await cleanup();
      } catch (e) {
        console.error('Failed to run cleanup:', e);
      }
    }
  }

  /**
   * Like running this.vm.execCommand, but retries the command if no output
   * is produced. Is a workaround for a strange behavior of this.vm.execCommand:
   * sometimes nothing is returned from stdout, as though it did not run at
   * all. See https://github.com/rancher-sandbox/rancher-desktop/issues/4473
   * for more info.
   */
  protected async execCommandWithRetries(options: execOptions & { capture: true }, ...command: string[]): Promise<string> {
    const maxRetries = 10;
    let result = '';

    for (let i = 0; i < maxRetries && !result; i++) {
      result = await this.vm.execCommand({ ...options, capture: true }, ...command);
    }

    return result;
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
      const container = (await this.execCommandWithRetries({ capture: true },
        '/usr/local/bin/nerdctl', ...namespaceArgs, 'create', '--entrypoint=/', imageID)).trim();

      cleanups.push(() => this.vm.execCommand(
        '/usr/local/bin/nerdctl', ...namespaceArgs, 'rm', '--force', '--volumes', container));

      const workdir = (await this.execCommandWithRetries({ capture: true }, '/bin/mktemp', '-d', '-t', 'rd-nerdctl-cp-XXXXXX')).trim();

      cleanups.push(() => this.vm.execCommand('/bin/rm', '-rf', workdir));

      const command = await this.execCommandWithRetries({ capture: true, root: true },
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

  async waitForReady(): Promise<void> {
    // We need to check two things: containerd, and buildkitd.
    const commandsToCheck = [
      ['/usr/local/bin/nerdctl', 'system', 'info'],
      ['/usr/local/bin/buildctl', 'debug', 'info'],
    ];

    for (const cmd of commandsToCheck) {
      while (true) {
        try {
          await this.vm.execCommand({ expectFailure: true, root: true }, ...cmd);
          break;
        } catch (ex) {
          // Ignore the error, try again
          await util.promisify(setTimeout)(1_000);
        }
      }
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
  copyFile(imageID: string, sourcePath: string, destinationDir: string, options: { namespace?: string }): Promise<void>;
  async copyFile(imageID: string, sourcePath: string, destinationDir: string, options?: { namespace?: string }): Promise<void> {
    const [imageDir, cleanups] = await this.mountImage(imageID, options?.namespace);

    try {
      // Archive the file(s) into the VM
      const workDir = (await this.execCommandWithRetries({ capture: true }, '/bin/mktemp', '-d', '-t', 'rd-nerdctl-cp-XXXXXX')).trim();
      const archive = path.posix.join(workDir, 'archive.tgz');
      const fileList = path.posix.join(workDir, 'files.txt');

      cleanups.push(() => this.vm.execCommand('/bin/rm', '-rf', workDir));
      let sourceName: string, sourceDir: string;

      if (sourcePath.endsWith('/')) {
        sourceName = '.';
        sourceDir = path.posix.join(imageDir, sourcePath);
      } else {
        sourceName = path.posix.basename(sourcePath);
        sourceDir = path.posix.join(imageDir, path.posix.dirname(sourcePath));
      }
      // Compute the list of all files to archive, but only including things
      // that (after resolving symlinks) point into the mount.
      // This means that absolute links to /proc etc. are skipped.
      await this.vm.execCommand({ root: true, cwd: sourceDir },
        '/usr/bin/find', '-L', sourceName, '-xdev',
        '-type', 'f', // After resolving symlinks, the target is a regular file
        '-exec', '/bin/sh', '-c', `readlink -f {} | grep -q '${ imageDir }'`, ';',
        '-exec', '/bin/sh', '-c', `echo '{}' >> ${ fileList }`, ';');

      const args = [
        '--create', '--gzip', '--file', archive, '--directory', sourceDir,
        '--dereference', '--one-file-system', '--sparse', '--files-from', fileList,
      ].filter(defined);

      await this.vm.execCommand({ root: true }, '/usr/bin/tar', ...args);

      // Copy the archive to the host
      const hostWorkDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'rd-nerdctl-copy-'));

      cleanups.push(() => fs.promises.rm(hostWorkDir, { recursive: true, maxRetries: 3 }));
      const hostArchive = path.join(hostWorkDir, 'copy-file.tgz');

      await this.vm.copyFileOut(archive, hostArchive);

      // Extract the archive into the destination.
      // Note that on Windows, we need to use the system-provided tar to handle Windows paths.
      const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot ?? `C:\\Windows`, 'system32', 'tar.exe') : '/usr/bin/tar';
      const extractArgs = ['xzf', hostArchive, '-C', destinationDir];

      await fs.promises.mkdir(path.normalize(destinationDir), { recursive: true });
      await spawnFile(tar, extractArgs, { stdio: console });
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
        ['image', 'list', '--format={{ .Name }}'], 'pipe', options);

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
    if (options?.namespace) {
      args.unshift('--namespace', options.namespace);
    }
    args.push(imageID);

    return (await this.nerdctl(...args)).trim();
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

  /**
   * Copy the given host directory into a temporary directory in the VM
   * @param hostPath The path on the host to a directory.
   * @returns The temporary path in the VM holding the results.
   */
  protected async copyDirectoryIn(hostPath: string): Promise<string> {
    const cleanups: (() => Promise<void>)[] = [];
    let succeeded = false;

    try {
      const workDir = (await this.vm.execCommand({ capture: true },
        '/bin/mktemp', '--directory', '--tmpdir', 'rd-nerdctl-copy-in-XXXXXX')).trim();

      cleanups.push(() => this.vm.execCommand('/bin/rm', '-rf', workDir));

      const resultDir = (await this.vm.execCommand({ capture: true },
        '/bin/mktemp', '--directory', '--tmpdir', 'rd-nerdctl-copy-in-XXXXXX')).trim();

      cleanups.push(async() => {
        if (!succeeded) {
          await this.vm.execCommand('/bin/rm', '-rf', workDir);
        }
      });

      const archiveName = 'nerdctl-copy-in.tar';
      const hostDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'rd-nerdctl-copy-in-'));

      cleanups.push(() => fs.promises.rm(hostDir, { recursive: true, maxRetries: 3 }));

      const tarStream = fs.createWriteStream(path.join(hostDir, archiveName));
      const archive = tar.pack();
      const archiveFinished = util.promisify(stream.finished)(archive as any);
      const newEntry = util.promisify(archive.entry.bind(archive));
      const baseHeader: Partial<tar.Headers> = {
        mode:  0o755,
        uid:   0,
        uname: 'root',
        gname: 'wheel',
        type:  'directory',
      };
      const walk = async(dir: string) => {
        const fullPath = path.normalize(path.join(hostPath, dir));

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

      await this.vm.copyFileIn(path.join(hostDir, archiveName), path.posix.join(workDir, archiveName));
      await this.vm.execCommand('/usr/bin/tar', 'xf', path.posix.join(workDir, archiveName), '-C', resultDir);
      succeeded = true;

      return resultDir;
    } finally {
      await this.runCleanups(cleanups);
    }
  }

  /**
   * Sets up the environment for compose.
   * @returns [projectDir] The compose project directory to use.
   * @returns [envFile] The environment file to use.
   * @returns [cleanups] Any cleanups we need to run after
   */
  protected async composePrep(options: ContainerComposeOptions): Promise<{
    projectDir: string,
    envFile: string,
    cleanups: (() => Promise<void>)[],
  }> {
    const cleanups: (() => Promise<void>)[] = [];
    const envData = Object.entries(options.env ?? {})
      .map(([k, v]) => `${ k }='${ v.replaceAll("'", "\\'") }'\n`)
      .join('');

    try {
      if (this.vm.backend === 'wsl') {
        // For WSL, we don't need to copy anything; nerdctl-stub will translate
        // the paths correctly.

        const workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'rd-compose-'));
        const envFile = path.join(workDir, 'env.txt');

        cleanups.push(() => fs.promises.rm(workDir, { recursive: true, maxRetries: 3 }));
        await fs.promises.writeFile(envFile, envData);

        return {
          projectDir: options.composeDir, envFile, cleanups,
        };
      }

      const projectDir = await this.copyDirectoryIn(options.composeDir);

      cleanups.push(() => this.vm.execCommand('/bin/rm', '-rf', projectDir));

      const envFile = (await (this.vm.execCommand({ capture: true },
        '/bin/mktemp', '--tmpdir', 'rd-nerdctl-compose-XXXXXX'))).trim();

      cleanups.push(() => this.vm.execCommand('/bin/rm', '-f', envFile));

      await this.vm.writeFile(envFile, envData);

      return {
        projectDir, envFile, cleanups,
      };
    } catch (ex) {
      await this.runCleanups(cleanups);
      throw ex;
    }
  }

  async composeUp(options: ContainerComposeOptions): Promise<void> {
    const { projectDir, envFile, cleanups } = await this.composePrep(options);

    try {
      const args = ['compose', '--project-directory', projectDir];

      if (options.name) {
        args.push('--project-name', options.name);
      }
      if (options.namespace) {
        args.unshift('--namespace', options.namespace);
      }
      if (options.env) {
        args.push('--env-file', envFile);
      }
      // nerdctl doesn't support --wait, so make do with --detach.
      args.push('up', '--quiet-pull', '--detach');

      const result = await this.nerdctl({ env: options.env ?? {} }, ...args);

      console.log('ran nerdctl compose up', result);
    } finally {
      await this.runCleanups(cleanups);
    }
  }

  async composeDown(options: ContainerComposeOptions): Promise<void> {
    const { projectDir, envFile, cleanups } = await this.composePrep(options);

    try {
      const args = [
        options.namespace ? ['--namespace', options.namespace] : [],
        ['compose'],
        options.name ? ['--project-name', options.name] : [],
        ['--project-directory', projectDir, 'down'],
        options.env ? ['--env-file', envFile] : [],
      ].flat();

      const result = await this.nerdctl(...args);

      console.debug('ran nerdctl compose down:', result);
    } finally {
      await this.runCleanups(cleanups);
    }
  }

  async composeExec(options: ContainerComposeExecOptions): Promise<ReadableProcess> {
    const { projectDir, envFile, cleanups } = await this.composePrep(options);

    try {
      const args = [
        options.namespace ? ['--namespace', options.namespace] : [],
        ['compose'],
        options.name ? ['--project-name', options.name] : [],
        ['--project-directory', projectDir],
        options.env ? ['--env-file', envFile] : [],
        ['exec', '--tty=false'],
        options.user ? ['--user', options.user] : [],
        options.workdir ? ['--workdir', options.workdir] : [],
        [options.service, ...options.command],
      ].flat();

      const result = spawn(executable('nerdctl'), args, { stdio: ['ignore', 'pipe', 'pipe'] });
      const delayedCleanups = cleanups.concat();

      // Delay running cleanups until the process has finished to avoid removing
      // files that may still be necessary.
      result.on('exit', () => this.runCleanups(delayedCleanups));
      result.on('error', () => this.runCleanups(delayedCleanups));
      cleanups.splice(0, cleanups.length);

      return result;
    } finally {
      await this.runCleanups(cleanups);
    }
  }

  async composePort(options: ContainerComposePortOptions): Promise<string> {
    const { projectDir, envFile, cleanups } = await this.composePrep(options);

    try {
      const args = [
        options.namespace ? ['--namespace', options.namespace] : [],
        ['compose'],
        options.name ? ['--project-name', options.name] : [],
        ['--project-directory', projectDir],
        options.env ? ['--env-file', envFile] : [],
        ['port'],
        options.protocol ? ['--protocol', options.protocol] : [],
        [options.service, options.port.toString(10)],
      ].flat();

      return (await this.nerdctl(...args)).trim();
    } finally {
      await this.runCleanups(cleanups);
    }
  }

  runClient(args: string[], stdio?: 'ignore', options?: ContainerRunClientOptions): Promise<Record<string, never>>;
  runClient(args: string[], stdio: Log, options?: ContainerRunClientOptions): Promise<Record<string, never>>;
  runClient(args: string[], stdio: 'pipe', options?: ContainerRunClientOptions): Promise<{ stdout: string; stderr: string; }>;
  runClient(args: string[], stdio: 'stream', options?: ContainerRunClientOptions): ReadableProcess;
  runClient(args: string[], stdio?: 'ignore' | 'pipe' | 'stream' | Log, options?: ContainerRunClientOptions) {
    const opts = _.merge({ env: process.env }, options);

    if (opts.namespace) {
      args = ['--namespace', opts.namespace].concat(args);
    }
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
