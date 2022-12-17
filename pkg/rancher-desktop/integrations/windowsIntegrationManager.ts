import fs from 'fs';
import path from 'path';

import { findHomeDir } from '@kubernetes/client-node';

import K3sHelper from '@pkg/backend/k3sHelper';
import { State } from '@pkg/backend/k8s';
import { Settings, ContainerEngine, runInDebugMode } from '@pkg/config/settings';
import type { IntegrationManager } from '@pkg/integrations/integrationManager';
import mainEvents from '@pkg/main/mainEvents';
import BackgroundProcess from '@pkg/utils/backgroundProcess';
import { spawn, spawnFile } from '@pkg/utils/childProcess';
import clone from '@pkg/utils/clone';
import Logging from '@pkg/utils/logging';
import paths from '@pkg/utils/paths';
import { executable } from '@pkg/utils/resources';
import { defined, RecursivePartial } from '@pkg/utils/typeUtils';

const console = Logging.integrations;

/**
 * A list of distributions in which we should never attempt to integrate with.
 */
const DISTRO_BLACKLIST = [
  'rancher-desktop', // That's ourselves
  'rancher-desktop-data', // Another internal distro
  'docker-desktop', // Not meant for interactive use
  'docker-desktop-data', // Not meant for interactive use
];

/**
 * Represents a WSL distro, as output by `wsl.exe --list --verbose`.
 */
export class WSLDistro {
  name: string;
  version: number;

  constructor(name: string, version: number) {
    this.name = name;
    if (![1, 2].includes(version)) {
      throw new Error(`version "${ version }" is not recognized by Rancher Desktop`);
    }
    this.version = version;
  }
}

/**
 * WindowsIntegrationManager manages various integrations on Windows, for both
 * the Win32 host, as well as for each (foreign) WSL distribution.
 * This includes:
 * - Docker socket forwarding.
 * - Kubeconfig.
 * - Docker-compose executable (WSL distributions only).
 */
export default class WindowsIntegrationManager implements IntegrationManager {
  /** A snapshot of the application-wide settings. */
  protected settings: RecursivePartial<Settings> = {};

  /** Background processes for docker socket forwarding, per WSL distribution. */
  protected distroSocketProxyProcesses: Record<string, BackgroundProcess> = {};

  /** Background process for docker socket forwarding to the Windows host. */
  protected windowsSocketProxyProcess: BackgroundProcess;

  /** Whether integrations as a whole are enabled. */
  protected enforcing = false;

  /** Whether the backend is in a state where the processes should run. */
  protected backendReady = false;

  /** Extra debugging arguments for wsl-helper. */
  protected wslHelperDebugArgs: string[] = [];

  constructor() {
    mainEvents.on('settings-update', (settings) => {
      this.wslHelperDebugArgs = runInDebugMode(settings.debug) ? ['--verbose'] : [];
      this.settings = clone(settings);
      this.sync();
    });
    mainEvents.on('k8s-check-state', (mgr) => {
      this.backendReady = [State.STARTED, State.STARTING, State.DISABLED].includes(mgr.state);
      this.sync();
    });
    this.windowsSocketProxyProcess = new BackgroundProcess(
      'Win32 socket proxy',
      {
        spawn: async() => {
          const stream = await Logging['wsl-helper'].fdStream;

          console.debug('Spawning Windows docker proxy');

          return spawn(
            path.join(paths.resources, 'win32', 'wsl-helper.exe'),
            ['docker-proxy', 'serve', ...this.wslHelperDebugArgs], {
              stdio:       ['ignore', stream, stream],
              windowsHide: true,
            });
        },
      });

    // Trigger a settings-update.
    mainEvents.emit('settings-write', {});
  }

  async enforce(): Promise<void> {
    this.enforcing = true;
    await this.sync();
  }

  async remove(): Promise<void> {
    this.enforcing = false;
    await this.sync();
  }

  async sync(): Promise<void> {
    try {
      await Promise.all([
        this.syncSocketProxy(),
        this.syncDockerCompose(),
        this.syncKubeconfig(),
      ]);
    } finally {
      mainEvents.emit('integration-update', await this.listIntegrations());
    }
  }

  #wslExe = '';
  /**
   * The path to the wsl.exe executable.
   *
   * @note This is memoized.
   */
  protected get wslExe(): Promise<string> {
    if (this.#wslExe) {
      return Promise.resolve(this.#wslExe);
    }

    if (process.env.RD_TEST_WSL_EXE) {
      // Running under test; use the alternate executable.
      return Promise.resolve(process.env.RD_TEST_WSL_EXE);
    }

    const wslExe = path.join(process.env.SystemRoot ?? '', 'system32', 'wsl.exe');

    return new Promise((resolve, reject) => {
      fs.promises.access(wslExe, fs.constants.X_OK).then(() => {
        this.#wslExe = wslExe;
        resolve(wslExe);
      }).catch(reject);
    });
  }

  /**
   * Execute the given command line in the given WSL distribution.
   * Output is logged to the log file.
   */
  protected async execCommand(opts: {distro?: string, encoding?:BufferEncoding, root?: boolean, env?: Record<string, string>}, ...command: string[]):Promise<void> {
    const logStream = opts.distro ? Logging[`wsl-helper.${ opts.distro }`] : console;
    const args = [];

    if (opts.distro) {
      args.push('--distribution', opts.distro);
      if (opts.root) {
        args.push('--user', 'root');
      }
      args.push('--exec');
    }
    args.push(...command);
    console.debug(`Running ${ await this.wslExe } ${ args.join(' ') }`);

    await spawnFile(
      await this.wslExe,
      args,
      {
        env:         opts.env,
        encoding:    opts.encoding ?? 'utf-8',
        stdio:       ['ignore', logStream, logStream],
        windowsHide: true,
      },
    );
  }

  /**
   * Runs the `wsl.exe` command, either on the host or in a specified
   * WSL distro. Returns whatever it prints to stdout, and logs whatever
   * it prints to stderr.
   */
  protected async captureCommand(opts: {distro?: string, encoding?: BufferEncoding, env?: Record<string, string>}, ...command: string[]):Promise<string> {
    const logStream = opts.distro ? Logging[`wsl-helper.${ opts.distro }`] : console;
    const args = [];

    if (opts.distro) {
      args.push('--distribution', opts.distro, '--exec');
    }
    args.push(...command);
    console.debug(`Running ${ await this.wslExe } ${ args.join(' ') }`);

    const { stdout } = await spawnFile(
      await this.wslExe,
      args,
      {
        env:         opts.env,
        encoding:    opts.encoding ?? 'utf-8',
        stdio:       ['ignore', 'pipe', logStream],
        windowsHide: true,
      },
    );

    return stdout;
  }

  /**
   * Return the Linux path to the WSL helper executable.
   */
  protected async getLinuxToolPath(distro: string, ...tool: string[]): Promise<string> {
    // We need to get the Linux path to our helper executable; it is easier to
    // just get WSL to do the transformation for us.

    const logStream = Logging[`wsl-helper.${ distro }`];
    const { stdout } = await spawnFile(
      await this.wslExe,
      ['--distribution', distro, '--exec', '/bin/wslpath', '-a', '-u',
        path.join(paths.resources, 'linux', ...tool)],
      { stdio: ['ignore', 'pipe', logStream] },
    );

    return stdout.trim();
  }

  protected async syncSocketProxy(): Promise<void> {
    const shouldRun =
      this.enforcing &&
      this.backendReady &&
      this.settings.kubernetes?.containerEngine === ContainerEngine.MOBY;

    console.debug(`Syncing socket proxy: ${ shouldRun ? 'should' : 'should not' } run.`);
    if (shouldRun) {
      this.windowsSocketProxyProcess.start();
    } else {
      await this.windowsSocketProxyProcess.stop();
    }

    await Promise.all(
      (await this.supportedDistros).map((distro) => {
        return this.syncDistroSocketProxy(distro.name, shouldRun);
      }),
    );
  }

  /**
   * SyncDistroProcessState ensures that the background process for the given
   * distribution is started or stopped, as desired.
   * @param distro The distribution to manage.
   * @param shouldRun Whether the docker socket proxy should be running.
   */
  protected async syncDistroSocketProxy(distro: string, shouldRun: boolean) {
    console.debug(`Syncing ${ distro } socket proxy: ${ shouldRun ? 'should' : 'should not' } run.`);
    if (shouldRun && this.settings.kubernetes?.WSLIntegrations?.[distro] === true) {
      const executable = await this.getLinuxToolPath(distro, 'wsl-helper');
      const logStream = Logging[`wsl-helper.${ distro }`];

      this.distroSocketProxyProcesses[distro] ??= new BackgroundProcess(
        `${ distro } socket proxy`,
        {
          spawn: async() => {
            return spawn(await this.wslExe,
              ['--distribution', distro, '--user', 'root', '--exec', executable,
                'docker-proxy', 'serve', ...this.wslHelperDebugArgs],
              {
                stdio:       ['ignore', await logStream.fdStream, await logStream.fdStream],
                windowsHide: true,
              },
            );
          },
          destroy: async(child) => {
            child.kill('SIGTERM');
            // Ensure we kill the WSL-side process; sometimes things can get out
            // of sync.
            await this.execCommand({ distro, root: true },
              executable, 'docker-proxy', 'kill', ...this.wslHelperDebugArgs);
          },
        });
      this.distroSocketProxyProcesses[distro].start();
    } else {
      await this.distroSocketProxyProcesses[distro]?.stop();
      if (!(distro in (this.settings.kubernetes?.WSLIntegrations ?? {}))) {
        delete this.distroSocketProxyProcesses[distro];
      }
    }
  }

  protected async syncDockerCompose() {
    await Promise.all([
      this.syncHostDockerCompose(),
      ...(await this.supportedDistros).map(distro => this.syncDistroDockerCompose(distro.name)),
    ]);
  }

  protected async syncHostDockerCompose() {
    const homeDir = findHomeDir();

    if (!homeDir) {
      throw new Error("Can't find home directory");
    }
    const cliDir = path.join(homeDir, '.docker', 'cli-plugins');
    const cliPath = path.join(cliDir, 'docker-compose.exe');
    const srcPath = executable('docker-compose');

    console.debug(`Syncing host docker compose: ${ srcPath } -> ${ cliPath }`);
    await fs.promises.mkdir(cliDir, { recursive: true });
    try {
      await fs.promises.copyFile(
        srcPath, cliPath,
        fs.constants.COPYFILE_EXCL | fs.constants.COPYFILE_FICLONE);
    } catch (error: any) {
      if (error?.code !== 'EEXIST') {
        console.error(`Failed to copy file ${ srcPath } to ${ cliPath }`, error);
      }
    }
  }

  protected async syncDistroDockerCompose(distro: string) {
    const srcPath = await this.getLinuxToolPath(distro, 'bin', 'docker-compose');
    const destDir = '$HOME/.docker/cli-plugins';
    const destPath = `${ destDir }/docker-compose`;
    const state = this.settings.kubernetes?.WSLIntegrations?.[distro] === true;

    console.debug(`Syncing ${ distro } docker compose: ${ srcPath } -> ${ destDir }`);
    if (state) {
      await this.execCommand({ distro }, '/bin/sh', '-c', `mkdir -p "${ destDir }"`);
      await this.execCommand({ distro }, '/bin/sh', '-c', `if [ ! -e "${ destPath }" -a ! -L "${ destPath }" ] ; then ln -s "${ srcPath }" "${ destPath }" ; fi`);
    } else {
      try {
        // This is preferred to doing the readlink and rm in one long /bin/sh
        // statement because then we rely on the distro's readlink supporting
        // the -n option. Gnu/linux readlink supports -f, On macOS the -f means
        // something else (not that we're likely to see macos WSLs).
        const targetPath = (await this.captureCommand({ distro }, '/bin/sh', '-c', `readlink -f "${ destPath }"`)).trimEnd();

        if (targetPath === srcPath) {
          await this.execCommand({ distro }, '/bin/sh', '-c', `rm "${ destPath }"`);
        }
      } catch (err) {
        console.log(`Failed to readlink/rm ${ destPath }`, err);
      }
    }
  }

  protected async syncKubeconfig() {
    const kubeconfigPath = await K3sHelper.findKubeConfigToUpdate('rancher-desktop');

    await Promise.all(
      (await this.supportedDistros).map((distro) => {
        return this.syncDistroKubeconfig(distro.name, kubeconfigPath);
      }),
    );
  }

  protected async syncDistroKubeconfig(distro: string, kubeconfigPath: string) {
    const state = this.settings.kubernetes?.WSLIntegrations?.[distro] === true;

    try {
      console.debug(`Syncing ${ distro } kubeconfig`);
      if (this.settings.kubernetes?.enabled) {
        await this.execCommand(
          {
            distro,
            env: {
              ...process.env,
              KUBECONFIG: kubeconfigPath,
              WSLENV:     `${ process.env.WSLENV }:KUBECONFIG/up`,
            },
          },
          await this.getLinuxToolPath(distro, 'wsl-helper'),
          'kubeconfig',
          `--enable=${ state }`,
        );
      }
    } catch (error: any) {
      if (typeof error?.stdout === 'string') {
        error.stdout = error.stdout.replace(/\0/g, '');
      }
      if (typeof error?.stderr === 'string') {
        error.stderr = error.stderr.replace(/\0/g, '');
      }
      console.error(`Could not set up kubeconfig integration for ${ distro }:`, error);

      return `Error setting up integration`;
    }
    console.log(`kubeconfig integration for ${ distro } set to ${ state }`);
  }

  protected get nonBlacklistedDistros(): Promise<WSLDistro[]> {
    return (async() => {
      let wslOutput: string;

      try {
        wslOutput = await this.captureCommand({ encoding: 'utf16le' }, '--list', '--verbose');
      } catch (error: any) {
        console.error(`Error listing distros: ${ error }`);

        return Promise.resolve([]);
      }
      // As wsl.exe may be localized, don't check state here.
      const parser = /^[\s*]+(?<name>.*?)\s+\w+\s+(?<version>\d+)\s*$/;

      return wslOutput.trim()
        .split(/[\r\n]+/)
        .slice(1) // drop the title row
        .map(line => line.match(parser)?.groups)
        .filter(defined)
        .map(group => new WSLDistro(group.name, parseInt(group.version)))
        .filter((distro: WSLDistro) => !DISTRO_BLACKLIST.includes(distro.name));
    })();
  }

  /**
   * Returns a list of WSL distros that RD can integrate with.
   */
  protected get supportedDistros(): Promise<WSLDistro[]> {
    return (async() => {
      return (await this.nonBlacklistedDistros).filter(distro => distro.version === 2);
    })();
  }

  async listIntegrations(): Promise<Record<string, boolean | string>> {
    const result: Record<string, boolean | string> = {};

    for (const distro of await this.nonBlacklistedDistros) {
      result[distro.name] = await this.getStateForIntegration(distro);
    }

    return result;
  }

  /**
   * Tells the caller what the state of a distro is. For more information see
   * the comment on `IntegrationManager.listIntegrations`.
   */
  protected async getStateForIntegration(distro: WSLDistro): Promise<boolean|string> {
    if (distro.version !== 2) {
      console.log(`WSL distro "${ distro.name }: is version ${ distro.version }`);

      return `Rancher Desktop can only integrate with v2 WSL distributions (this is v${ distro.version }).`;
    }
    if (!this.settings.kubernetes?.enabled) {
      return this.settings.kubernetes?.WSLIntegrations?.[distro.name] ?? false;
    }
    try {
      const executable = await this.getLinuxToolPath(distro.name, 'wsl-helper');
      const kubeconfigPath = await K3sHelper.findKubeConfigToUpdate('rancher-desktop');
      const stdout = await this.captureCommand(
        {
          distro: distro.name,
          env:    {
            ...process.env,
            KUBECONFIG: kubeconfigPath,
            WSLENV:     `${ process.env.WSLENV }:KUBECONFIG/up`,
          },
        },
        executable, 'kubeconfig', '--show');

      console.debug(`WSL distro "${ distro.name }: wsl-helper output: "${ stdout }"`);
      if (['true', 'false'].includes(stdout.trim())) {
        return stdout.trim() === 'true';
      } else {
        return `Error: ${ stdout.trim() }`;
      }
    } catch (error) {
      console.log(`WSL distro "${ distro.name }" error: ${ error }`);
      if ((typeof error === 'object' && error) || typeof error === 'string') {
        return `Error: ${ error }`;
      } else {
        return `Error: unexpected error getting state of distro`;
      }
    }
  }

  async removeSymlinksOnly(): Promise<void> {}
}
