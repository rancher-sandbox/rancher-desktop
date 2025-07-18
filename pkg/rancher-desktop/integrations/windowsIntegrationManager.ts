import fs from 'fs';
import os from 'os';
import path from 'path';

import semver from 'semver';

import DEPENDENCY_VERSIONS from '@pkg/assets/dependencies.yaml';
import K3sHelper from '@pkg/backend/k3sHelper';
import { State } from '@pkg/backend/k8s';
import { Settings, ContainerEngine } from '@pkg/config/settings';
import { runInDebugMode } from '@pkg/config/settingsImpl';
import type { IntegrationManager } from '@pkg/integrations/integrationManager';
import mainEvents from '@pkg/main/mainEvents';
import BackgroundProcess from '@pkg/utils/backgroundProcess';
import { spawn, spawnFile } from '@pkg/utils/childProcess';
import clone from '@pkg/utils/clone';
import Latch from '@pkg/utils/latch';
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
  name:    string;
  version: number;

  constructor(name: string, version: number) {
    this.name = name;
    if (![1, 2].includes(version)) {
      throw new Error(`version "${ version }" is not recognized by Rancher Desktop`);
    }
    this.version = version;
  }
}

enum SyncStateKey {
  /** No sync is ongoing. */
  IDLE,
  /** A sync is running, but there is no queued sync. */
  ACTIVE,
  /** A sync is running, there is also a queued sync that will happen after. */
  QUEUED,
}

type SyncState =
  { state: SyncStateKey.IDLE } |
  /** The `active` promise will be resolved once the current sync is complete. */
  { state: SyncStateKey.ACTIVE, active: ReturnType<typeof Latch> } |
  /** The `queued` promise will be resolved after the current sync +1 is complete. */
  { state: SyncStateKey.QUEUED, active: ReturnType<typeof Latch>, queued: ReturnType<typeof Latch> };

/**
 * DiagnosticKey limits the `key` argument of the diagnostic events.
 */
type DiagnosticKey =
  'docker-plugins' |
  'docker-socket' |
  'kubeconfig' |
  'spin-cli' |
  never;

/**
 * WindowsIntegrationManager manages various integrations on Windows, for both
 * the Win32 host, as well as for each (foreign) WSL distribution.
 * This includes:
 * - Docker socket forwarding.
 * - Kubeconfig.
 * - docker CLI plugin executables (WSL distributions only).
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

  protected syncState: SyncState = { state: SyncStateKey.IDLE };

  /** Whether the backend is in a state where the processes should run. */
  protected backendReady = false;

  /** Set when we're about to quit. */
  protected quitting = false;

  /** Extra debugging arguments for wsl-helper. */
  protected wslHelperDebugArgs: string[] = [];

  /** Singleton instance. */
  private static instance: WindowsIntegrationManager;

  constructor() {
    mainEvents.on('settings-update', (settings) => {
      this.wslHelperDebugArgs = runInDebugMode(settings.application.debug) ? ['--verbose'] : [];
      this.settings = clone(settings);
      this.sync();
    });
    mainEvents.on('k8s-check-state', (mgr) => {
      this.backendReady = [State.STARTED, State.STARTING, State.DISABLED].includes(mgr.state);
      this.sync();
    });
    mainEvents.handle('shutdown-integrations', async() => {
      this.quitting = true;
      await Promise.all(Object.values(this.distroSocketProxyProcesses).map(p => p.stop()));
    });
    this.windowsSocketProxyProcess = new BackgroundProcess(
      'Win32 socket proxy',
      {
        spawn: async() => {
          const stream = await Logging['wsl-helper'].fdStream;

          console.debug('Spawning Windows docker proxy');

          return spawn(
            executable('wsl-helper'),
            ['docker-proxy', 'serve', ...this.wslHelperDebugArgs], {
              stdio:       ['ignore', stream, stream],
              windowsHide: true,
            });
        },
      });

    // Trigger a settings-update.
    mainEvents.emit('settings-write', {});
  }

  /** Static method to access the singleton instance. */
  public static getInstance(): WindowsIntegrationManager {
    WindowsIntegrationManager.instance ||= new WindowsIntegrationManager();

    return WindowsIntegrationManager.instance;
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
    const latch = Latch();

    switch (this.syncState.state) {
    case SyncStateKey.IDLE:
      this.syncState = { state: SyncStateKey.ACTIVE, active: latch };
      break;
    case SyncStateKey.ACTIVE: {
      // There is a sync already active; wait for it, then do the re-sync.
      const { active } = this.syncState;

      this.syncState = {
        state: SyncStateKey.QUEUED, active, queued: latch,
      };
      console.debug('Waiting for previous sync to finish before starting new sync.');
      await active;
      // Continue with the rest of the function, in ACTIVE mode.
      break;
    }
    case SyncStateKey.QUEUED:
      // We already have a queued sync; just wait for that to complete.
      console.debug('Merging duplicate sync with previous pending sync.');

      return this.syncState.queued;
    }
    try {
      let kubeconfigPath: string | undefined;

      try {
        kubeconfigPath = await K3sHelper.findKubeConfigToUpdate('rancher-desktop');
        this.diagnostic({ key: 'kubeconfig' });
      } catch (error) {
        console.error(`Could not determine kubeconfig: ${ error } - Kubernetes configuration will not be updated.`);
        this.diagnostic({ key: 'kubeconfig', error });
        kubeconfigPath = undefined;
      }

      await Promise.all([
        this.syncHostSocketProxy(),
        this.syncHostDockerPluginConfig(),
        ...(await this.supportedDistros).map(distro => this.syncDistro(distro.name, kubeconfigPath)),
      ]);
    } catch (ex) {
      console.error(`Integration sync: Error: ${ ex }`);
    } finally {
      mainEvents.emit('integration-update', await this.listIntegrations());
      // TypeScript is being too smart and thinking we can only be ACTIVE here;
      // but that may be set from concurrent calls to sync().
      const currentState: SyncState = this.syncState as any;

      switch (currentState.state) {
      case SyncStateKey.IDLE:
        // This should never be reached
        break;
      case SyncStateKey.ACTIVE:
        this.syncState = { state: SyncStateKey.IDLE };
        break;
      case SyncStateKey.QUEUED:
        this.syncState = { state: SyncStateKey.ACTIVE, active: currentState.queued };
        // The sync() that set the state to QUEUED will continue, and eventually
        // set the state back to IDLE.
      }
      latch.resolve();
    }
  }

  async syncDistro(distro: string, kubeconfigPath?: string): Promise<void> {
    let state = this.settings.WSL?.integrations?.[distro] === true;

    console.debug(`Integration sync: ${ distro } -> ${ state }`);
    try {
      await Promise.all([
        this.syncDistroSocketProxy(distro, state),
        this.syncDistroDockerPlugins(distro, state),
        this.syncDistroKubeconfig(distro, kubeconfigPath, state),
        this.syncDistroSpinCLI(distro, state),
      ]);
    } catch (ex) {
      console.error(`Failed to sync integration for ${ distro }: ${ ex }`);
      mainEvents.emit('settings-write', { WSL: { integrations: { [distro]: false } } });
      state = false;
    } finally {
      await this.markIntegration(distro, state);
    }
  }

  /**
   * Helper function to trigger a diagnostic report.  If a diagnostic should be
   * cleared, call this with the error unset.
   */
  protected diagnostic(input: { key: DiagnosticKey, distro?: string, error?: unknown }) {
    const error = input.error instanceof Error ? input.error : input.error ? new Error(`${ input.error }`) : undefined;

    mainEvents.emit('diagnostics-event', {
      id:     'integrations-windows',
      key:    input.key,
      distro: input.distro,
      error,
    });
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
  protected async execCommand(opts: { distro?: string, encoding?: BufferEncoding, root?: boolean, env?: Record<string, string> }, ...command: string[]):Promise<void> {
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
  protected async captureCommand(opts: { distro?: string, encoding?: BufferEncoding, env?: Record<string, string> }, ...command: string[]):Promise<string> {
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
  protected async getLinuxToolPath(distro: string, tool: string): Promise<string> {
    // We need to get the Linux path to our helper executable; it is easier to
    // just get WSL to do the transformation for us.
    return (await this.captureCommand( { distro }, '/bin/wslpath', '-a', '-u', tool)).trim();
  }

  protected async syncHostSocketProxy(): Promise<void> {
    const reason = this.dockerSocketProxyReason;

    console.debug(`Syncing Win32 socket proxy: ${ reason ? `should not run (${ reason })` : 'should run' }`);
    try {
      if (!reason) {
        this.windowsSocketProxyProcess.start();
      } else {
        await this.windowsSocketProxyProcess.stop();
      }
      this.diagnostic({ key: 'docker-socket' });
    } catch (error) {
      this.diagnostic({ key: 'docker-socket', error });
    }
  }

  /**
   * Get the reason that the docker socket should not run; if it _should_ run,
   * returns undefined.
   */
  get dockerSocketProxyReason(): string | undefined {
    if (this.quitting) {
      return 'quitting Rancher Desktop';
    } else if (!this.enforcing) {
      return 'not enforcing';
    } else if (!this.backendReady) {
      return 'backend not ready';
    } else if (this.settings.containerEngine?.name !== ContainerEngine.MOBY) {
      return `unsupported container engine ${ this.settings.containerEngine?.name }`;
    }
  }

  /**
   * syncDistroSocketProxy ensures that the background process for the given
   * distribution is started or stopped, as desired.
   * @param distro The distribution to manage.
   * @param state Whether integration is enabled for the given distro.
   */
  protected async syncDistroSocketProxy(distro: string, state: boolean) {
    try {
      const shouldRun = state && !this.dockerSocketProxyReason;

      console.debug(`Syncing ${ distro } socket proxy: ${ shouldRun ? 'should' : 'should not' } run.`);
      if (shouldRun) {
        const linuxExecutable = await this.getLinuxToolPath(distro, executable('wsl-helper-linux'));
        const logStream = Logging[`wsl-helper.${ distro }`];

        this.distroSocketProxyProcesses[distro] ??= new BackgroundProcess(
          `${ distro } socket proxy`,
          {
            spawn: async() => {
              return spawn(await this.wslExe,
                ['--distribution', distro, '--user', 'root', '--exec', linuxExecutable,
                  'docker-proxy', 'serve', ...this.wslHelperDebugArgs],
                {
                  stdio:       ['ignore', await logStream.fdStream, await logStream.fdStream],
                  windowsHide: true,
                },
              );
            },
            destroy: async(child) => {
              child?.kill('SIGTERM');
              // Ensure we kill the WSL-side process; sometimes things can get out
              // of sync.
              await this.execCommand({ distro, root: true },
                linuxExecutable, 'docker-proxy', 'kill', ...this.wslHelperDebugArgs);
            },
          });
        this.distroSocketProxyProcesses[distro].start();
      } else {
        await this.distroSocketProxyProcesses[distro]?.stop();
        if (!(distro in (this.settings.WSL?.integrations ?? {}))) {
          delete this.distroSocketProxyProcesses[distro];
        }
      }
      this.diagnostic({ key: 'docker-socket', distro });
    } catch (error) {
      console.error(`Error syncing ${ distro } distro socket proxy: ${ error }`);
      this.diagnostic({
        key: 'docker-socket', distro, error,
      });
    }
  }

  protected async syncHostDockerPluginConfig() {
    try {
      const configPath = path.join(os.homedir(), '.docker', 'config.json');
      let config: { cliPluginsExtraDirs?: string[] } = {};

      try {
        config = JSON.parse(await fs.promises.readFile(configPath, 'utf-8'));
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
          // If the file does not exist, create it.
        } else {
          console.error(`Could not set up docker plugins:`, error);
          this.diagnostic({ key: 'docker-plugins', error });

          return;
        }
      }

      // All of the docker plugins are in the `docker-cli-plugins` directory.
      const binDir = path.join(paths.resources, process.platform, 'docker-cli-plugins');

      if (config.cliPluginsExtraDirs?.includes(binDir)) {
        // If it's already configured, no need to do so again.
        return;
      }

      config.cliPluginsExtraDirs ??= [];
      config.cliPluginsExtraDirs.push(binDir);

      await fs.promises.mkdir(path.dirname(configPath), { recursive: true });
      await fs.promises.writeFile(configPath, JSON.stringify(config), 'utf-8');
      this.diagnostic({ key: 'docker-plugins' });
    } catch (error) {
      this.diagnostic({ key: 'docker-plugins', error });
    }
  }

  /**
   * syncDistroDockerPlugins sets up docker CLI configuration in WSL distros to
   * use the plugins shipped with Rancher Desktop.
   * @param distro The distribution to update.
   * @param state Whether the plugins should be enabled.
   */
  protected async syncDistroDockerPlugins(distro: string, state: boolean): Promise<void> {
    try {
      const binDir = await this.getLinuxToolPath(distro,
        path.join(paths.resources, 'linux', 'bin'));
      const srcPath = await this.getLinuxToolPath(distro,
        path.join(paths.resources, 'linux', 'docker-cli-plugins'));
      const wslHelper = await this.getLinuxToolPath(distro, executable('wsl-helper-linux'));
      const args = ['wsl', 'integration', 'docker',
        `--plugin-dir=${ srcPath }`, `--bin-dir=${ binDir }`, `--state=${ state }`];

      if (this.settings.application?.debug) {
        args.push('--verbose');
      }

      await this.execCommand({ distro }, wslHelper, ...args);
      this.diagnostic({ key: 'docker-plugins', distro });
    } catch (error) {
      console.error(`Failed to set up ${ distro } docker plugins: ${ error }`.trim());
      this.diagnostic({
        key: 'docker-plugins', distro, error,
      });
    }
  }

  /**
   * verifyAllDistrosKubeConfig loops through all the available distros
   * and checks if the kubeconfig can be managed; if any distro fails
   * the check, an exception is thrown.
   */
  async verifyAllDistrosKubeConfig() {
    const distros = await this.supportedDistros;

    await Promise.all(distros.map(async(distro) => {
      await this.verifyDistroKubeConfig(distro.name);
    }));
  }

  /**
   * verifyDistroKubeConfig calls the wsl-helper kubeconfig --verify per distro.
   * It determines the condition of the kubeConfig from the returned error code.
   */
  protected async verifyDistroKubeConfig(distro: string) {
    try {
      const wslHelper = await this.getLinuxToolPath(distro, executable('wsl-helper-linux'));

      await this.execCommand({ distro }, wslHelper, 'kubeconfig', '--verify');
    } catch (err: any) {
      // Only throw for a specific error code 1, since we control that from the
      // kubeconfig --verify command. The logic here is to bubble up this error
      // so that the diagnostic is very specific to this issue. Any other errors
      // are captured as log messages.
      if (err && 'code' in err && err.code === 1) {
        throw new Error(`The kubeConfig contains non-Rancher Desktop configuration in distro ${ distro }`);
      } else {
        console.error(`Verifying kubeconfig in distro ${ distro } failed: ${ err }`);
      }
    }
    console.debug(`Verified kubeconfig in the following distro: ${ distro }`);
  }

  protected async syncDistroKubeconfig(distro: string, kubeconfigPath: string | undefined, state: boolean) {
    if (!kubeconfigPath) {
      console.debug(`Skipping syncing ${ distro } kubeconfig: no kubeconfig found`);
      this.diagnostic({ key: 'kubeconfig', distro });

      return 'Error setting up integration';
    }
    try {
      console.debug(`Syncing ${ distro } kubeconfig`);
      await this.execCommand(
        {
          distro,
          env: {
            ...process.env,
            KUBECONFIG: kubeconfigPath,
            WSLENV:     `${ process.env.WSLENV }:KUBECONFIG/up`,
          },
        },
        await this.getLinuxToolPath(distro, executable('wsl-helper-linux')),
        'kubeconfig',
        `--enable=${ state && this.settings.kubernetes?.enabled }`,
      );
      this.diagnostic({ key: 'kubeconfig', distro });
    } catch (error: any) {
      if (typeof error?.stdout === 'string') {
        error.stdout = error.stdout.replace(/\0/g, '');
      }
      if (typeof error?.stderr === 'string') {
        error.stderr = error.stderr.replace(/\0/g, '');
      }
      console.error(`Could not set up kubeconfig integration for ${ distro }:`, error);
      this.diagnostic({
        key: 'kubeconfig', distro, error,
      });

      return `Error setting up integration`;
    }
    console.log(`kubeconfig integration for ${ distro } set to ${ state }`);
  }

  protected async syncDistroSpinCLI(distro: string, state: boolean) {
    try {
      if (state && this.settings.experimental?.containerEngine?.webAssembly) {
        const version = semver.parse(DEPENDENCY_VERSIONS.spinCLI);
        const env = {
          KUBE_PLUGIN_VERSION: DEPENDENCY_VERSIONS.spinKubePlugin,
          SPIN_TEMPLATES_TAG:  (version ? `spin/templates/v${ version.major }.${ version.minor }` : 'unknown'),
        };
        const wslenv = Object.keys(env).join(':');

        // wsl-exec is needed to correctly resolve DNS names
        await this.execCommand({
          distro,
          env: {
            ...process.env, ...env, WSLENV: wslenv,
          },
        }, await this.getLinuxToolPath(distro, executable('setup-spin')));
      }
      this.diagnostic({ key: 'spin-cli', distro });
    } catch (error) {
      this.diagnostic({
        key: 'spin-cli', distro, error,
      });
    }
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
        .map(line => (parser.exec(line))?.groups)
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

  protected async markIntegration(distro: string, state: boolean): Promise<void> {
    try {
      const exe = await this.getLinuxToolPath(distro, executable('wsl-helper-linux'));
      const mode = state ? 'set' : 'delete';

      await this.execCommand({ distro, root: true }, exe, 'wsl', 'integration', 'state', `--mode=${ mode }`);
    } catch (ex) {
      console.error(`Failed to mark integration for ${ distro }:`, ex);
    }
  }

  async listIntegrations(): Promise<Record<string, boolean | string>> {
    // Get the results in parallel
    const distros = await this.nonBlacklistedDistros;
    const states = distros.map(d => (async() => [d.name, await this.getStateForIntegration(d)] as const)());

    return Object.fromEntries(await Promise.all(states));
  }

  /**
   * Tells the caller what the state of a distro is. For more information see
   * the comment on `IntegrationManager.listIntegrations`.
   */
  protected async getStateForIntegration(distro: WSLDistro): Promise<boolean | string> {
    if (distro.version !== 2) {
      console.log(`WSL distro "${ distro.name }": is version ${ distro.version }`);

      return `Rancher Desktop can only integrate with v2 WSL distributions (this is v${ distro.version }).`;
    }
    try {
      const exe = await this.getLinuxToolPath(distro.name, executable('wsl-helper-linux'));
      const stdout = await this.captureCommand(
        { distro: distro.name },
        exe, 'wsl', 'integration', 'state', '--mode=show');

      console.debug(`WSL distro "${ distro.name }": wsl-helper output: "${ stdout.trim() }"`);
      if (['true', 'false'].includes(stdout.trim())) {
        return stdout.trim() === 'true';
      } else {
        return `Error: ${ stdout.trim() }`;
      }
    } catch (error) {
      console.log(`WSL distro "${ distro.name }" ${ error }`);
      if ((typeof error === 'object' && error) || typeof error === 'string') {
        return `${ error }`;
      } else {
        return `Error: unexpected error getting state of distro`;
      }
    }
  }

  async removeSymlinksOnly(): Promise<void> {}
}
