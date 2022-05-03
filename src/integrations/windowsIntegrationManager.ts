import fs from 'fs';
import path from 'path';

import { findHomeDir } from '@/config/findHomeDir';
import { Settings, ContainerEngine } from '@/config/settings';
import BackgroundProcess from '@/integrations/backgroundProcess';
import type { IntegrationManager } from '@/integrations/integrationManager';
import K3sHelper from '@/k8s-engine/k3sHelper';
import { State } from '@/k8s-engine/k8s';
import mainEvents from '@/main/mainEvents';
import { spawn, spawnFile } from '@/utils/childProcess';
import Logging from '@/utils/logging';
import paths from '@/utils/paths';
import resources from '@/utils/resources';
import { RecursivePartial } from '@/utils/typeUtils';

const console = Logging.integrations;

/**
 * WindowsIntegrationManager managers various integrations on Windows, for both
 * the Win32 host, as well as for each (foreign) WSL distribution.
 * This includes:
 * - Docker socket forwarding.
 * - Kubeconfig.
 * - Docker compose executable (WSL distributions only).
 */
export default class WindowsIntegrationManager implements IntegrationManager {
  /** Whether integration should be enabled for a given WSL distribution. */
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
      this.wslHelperDebugArgs = settings.debug ? ['--verbose'] : [];
      this.settings = JSON.parse(JSON.stringify(settings));
      this.sync();
    });
    mainEvents.on('k8s-check-state', (mgr) => {
      this.backendReady = [State.STARTED, State.STARTING, State.DISABLED].includes(mgr.state);
      this.sync();
    });
    this.windowsSocketProxyProcess = new BackgroundProcess(
      'Win32 socket proxy', async() => {
        const stream = await Logging['wsl-helper'].fdStream;

        console.debug('Spawning Windows docker proxy');

        return spawn(
          path.join(paths.resources, 'win32', 'wsl-helper.exe'),
          ['docker-proxy', 'serve', ...this.wslHelperDebugArgs], {
            stdio:       ['ignore', stream, stream],
            windowsHide: true,
          });
      });

    // Trigger a settings-update.
    mainEvents.emit('settings-write', {});
  }

  /** Get all possible distro names. */
  protected get distros() {
    return Array.from(new Set([
      ...Object.keys(this.settings.kubernetes?.WSLIntegrations ?? {}),
      ...Object.keys(this.distroSocketProxyProcesses),
    ]));
  }

  async enforce(): Promise<void> {
    this.enforcing = true;
    await this.sync();
  }

  async remove(): Promise<void> {
    this.enforcing = false;
    await this.sync();
  }

  async sync() {
    await Promise.all([
      this.syncSocketProxy(),
      this.syncDockerCompose(),
      this.syncKubeconfig(),
    ]);
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
  protected async execCommand(opts: {distro: string, root?: boolean, env?: Record<string, string>}, ...command: string[]):Promise<void> {
    const logStream = Logging[`wsl-helper.${ opts.distro }`];
    const args = ['--distribution', opts.distro];

    if (opts.root) {
      args.push('--user', 'root');
    }
    args.push('--exec', ...command);
    console.debug(`Running ${ await this.wslExe } ${ args.join(' ') }`);

    await spawnFile(
      await this.wslExe,
      args,
      {
        env:         opts.env,
        encoding:    'utf-8',
        stdio:       ['ignore', logStream, logStream],
        windowsHide: true,
      }
    );
  }

  protected async captureCommand(options: {distro: string}, ...command: string[]):Promise<string> {
    const logStream = Logging[`wsl-helper.${ options.distro }`];
    const args = ['--distribution', options.distro, '--user', 'root', '--exec', ...command];

    console.debug(`Running ${ await this.wslExe } ${ args.join(' ') }`);

    const { stdout } = await spawnFile(
      await this.wslExe,
      args,
      {
        encoding:    'utf-8',
        stdio:       ['ignore', 'pipe', logStream],
        windowsHide: true,
      }
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
      { stdio: ['ignore', 'pipe', logStream] }
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
      this.windowsSocketProxyProcess.stop();
    }
    await Promise.all(this.distros.map(distro => this.syncDistroSocketProxy(distro, shouldRun)));
  }

  /**
   * SyncDistroProcessState ensures that the background process for the given
   * distribution is started or stopped, as desired.
   * @param distro The distribution to manage.
   */
  protected async syncDistroSocketProxy(distro: string, shouldRun: boolean) {
    console.debug(`Syncing ${ distro } socket proxy: ${ shouldRun ? 'should' : 'should not' } run.`);
    if (shouldRun && this.settings.kubernetes?.WSLIntegrations?.[distro] === true) {
      const executable = await this.getLinuxToolPath(distro, 'wsl-helper');
      const logStream = Logging[`wsl-helper.${ distro }`];

      this.distroSocketProxyProcesses[distro] ??= new BackgroundProcess(
        `${ distro } socket proxy`,
        async() => {
          return spawn(await this.wslExe,
            ['--distribution', distro, '--user', 'root', '--exec', executable,
              'docker-proxy', 'serve', ...this.wslHelperDebugArgs],
            {
              stdio:       ['ignore', await logStream.fdStream, await logStream.fdStream],
              windowsHide: true
            }
          );
        },
        async(child) => {
          child.kill('SIGTERM');
          // Ensure we kill the WSL-side process; sometimes things can get out
          // of sync.
          await this.execCommand({ distro, root: true },
            executable, 'docker-proxy', 'kill', ...this.wslHelperDebugArgs);
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
      ...this.distros.map(distro => this.syncDistroDockerCompose(distro)),
    ]);
  }

  protected async syncHostDockerCompose() {
    const homeDir = findHomeDir();

    if (!homeDir) {
      throw new Error("Can't find home directory");
    }
    const cliDir = path.join(homeDir, '.docker', 'cli-plugins');
    const cliPath = path.join(cliDir, 'docker-compose.exe');
    const srcPath = resources.executable('docker-compose');

    console.debug(`Syncing host docker compose: ${ srcPath } -> ${ cliPath }`);
    try {
      await fs.promises.access(cliPath);
      // Nothing to do if the file exists
    } catch (err: any) {
      if (err.code !== 'ENOENT') {
        console.error(`Can't create the cli-plugins directory:`, err);

        return;
      }
      await fs.promises.mkdir(cliDir, { recursive: true });

      try {
        await fs.promises.copyFile(srcPath, cliPath, fs.constants.COPYFILE_EXCL);
      } catch (err2) {
        console.error(`Failed to copy file ${ srcPath } to ${ cliPath }`, err2);
      }
    }
  }

  protected async syncDistroDockerCompose(distro: string) {
    const srcPath = await this.getLinuxToolPath(distro, 'bin', 'docker-compose');
    const destDir = '$HOME/.docker/cli-plugins';
    const destPath = `${ destDir }/docker-compose`;
    const state = this.settings.kubernetes?.WSLIntegrations?.[distro] === true;

    console.debug(`Syncing ${ distro } docker compose: ${ srcPath } -> ${ destDir }`);
    // Update only the distro -- the current
    if (state) {
      await this.execCommand({ distro }, '/bin/sh', '-c', `mkdir -p "${ destDir }"`);
      await this.execCommand({ distro }, '/bin/sh', '-c', `if [ ! -e "${ destPath }" -a ! -L "${ destPath }" ] ; then ln -s "${ srcPath }" "${ destPath }" ; fi`);
    } else {
      try {
        // This is preferred to doing the readlink and rm in one long /bin/sh statement because
        // then we rely on the distro's readlink supporting the -n option. Gnu/linux readlink supports -f,
        // On macOS the -f means something else (not that we're likely to see macos WSLs).
        const targetPath = (await this.captureCommand({ distro }, 'readlink', '-f', destPath)).trimEnd();

        if (targetPath === srcPath) {
          await this.execCommand({ distro }, 'rm', destPath);
        }
      } catch (err) {
        console.log(`Failed to readlink/rm ${ destPath }`, err);
      }
    }
  }

  protected async syncKubeconfig() {
    const kubeconfigPath = await K3sHelper.findKubeConfigToUpdate('rancher-desktop');

    await Promise.all(this.distros.map(distro => this.syncDistroKubeconfig(distro, kubeconfigPath)));
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
            }
          },
          await this.getLinuxToolPath(distro, 'wsl-helper'),
          'kubeconfig',
          `--enable=${ state }`,
        );
      }
    } catch (error) {
      const errorAny = error as any;

      if ('stdout' in errorAny && typeof errorAny.stdout === 'string') {
        errorAny.stdout = errorAny.stdout.replace(/\0/g, '');
      }
      if ('stderr' in errorAny && typeof errorAny.stderr === 'string') {
        errorAny.stderr = errorAny.stderr.replace(/\0/g, '');
      }
      console.error(`Could not set up kubeconfig integration for ${ distro }:`, error);

      return `Error setting up integration`;
    }
    console.log(`kubeconfig integration for ${ distro } set to ${ state }`);
  }

  async removeSymlinksOnly(): Promise<void> {}
}
