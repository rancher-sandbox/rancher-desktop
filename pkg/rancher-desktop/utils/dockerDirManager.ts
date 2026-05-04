import fs from 'fs';
import os from 'os';
import path from 'path';

import yaml from 'yaml';

import paths from './paths';

import mainEvents from '@pkg/main/mainEvents';
import { spawnFile } from '@pkg/utils/childProcess';
import clone from '@pkg/utils/clone';
import Logging from '@pkg/utils/logging';
import { jsonStringifyWithWhiteSpace } from '@pkg/utils/stringify';

const console = Logging.background;

/**
 * Goes under the `auths` key in docker config.json.
 */
interface AuthConfig {
  username?:      string,
  password?:      string,
  auth?:          string,
  email?:         string,
  serveraddress?: string,
  identitytoken?: string,
  registrytoken?: string,
}

/**
 * The parts of a docker config.json file that concern Rancher Desktop.
 */
interface PartialDockerConfig {
  auths?:          Record<string, AuthConfig>,
  credsStore?:     string,
  credHelpers?:    Record<string, string>,
  currentContext?: string,
}

/**
 * Manages everything under the docker CLI config directory (except, at
 * the time of writing, docker CLI plugins).
 */
export class DockerDirManager {
  protected readonly dockerDirPath:        string;
  protected readonly dockerContextDirPath: string;
  /**
   * Path to the 'rancher-desktop' docker context file.  The parent directory
   * is the SHA256 hash of the docker context name ('rancher-desktop'), per the
   * docker convention.
   */
  protected readonly dockerContextPath:    string;
  protected readonly dockerConfigPath:     string;
  protected readonly defaultDockerSockPath = '/var/run/docker.sock';
  protected readonly contextName = 'rancher-desktop';

  /**
   * @param dockerDirPath The path to the directory containing docker CLI config.
   */
  constructor(dockerDirPath: string) {
    this.dockerDirPath = dockerDirPath;
    this.dockerContextDirPath = path.join(this.dockerDirPath, 'contexts', 'meta');
    this.dockerContextPath = path.join(this.dockerContextDirPath,
      'b547d66a5de60e5f0843aba28283a8875c2ad72e99ba076060ef9ec7c09917c8', 'meta.json');
    this.dockerConfigPath = path.join(this.dockerDirPath, 'config.json');
    console.debug(`Created new DockerDirManager to manage dir: ${ this.dockerDirPath }`);
  }

  /**
   * Gets the docker CLI config.json file as an object.
   */
  protected async readDockerConfig(): Promise<PartialDockerConfig> {
    try {
      const rawConfig = await fs.promises.readFile(this.dockerConfigPath, { encoding: 'utf-8' });

      return JSON.parse(rawConfig);
    } catch (cause: any) {
      if (cause.code !== 'ENOENT') {
        throw new Error(`Failed to parse Docker config file '${ this.dockerConfigPath }'. Error: ${ cause.message }`, { cause });
      }
      console.log('No docker config file found');

      return {};
    }
  }

  /**
   * Writes the docker CLI config.json file.
   * @param config An object that is the config we want to write.
   */
  protected async writeDockerConfig(config: PartialDockerConfig): Promise<void> {
    const rawConfig = jsonStringifyWithWhiteSpace(config);

    await fs.promises.mkdir(this.dockerDirPath, { recursive: true });
    await fs.promises.writeFile(this.dockerConfigPath, rawConfig, { encoding: 'utf-8' });
    console.log(`Wrote docker config: ${ JSON.stringify(config) }`);
  }

  /**
   * Read the docker configuration, and return the docker socket in use by the
   * current context.  If the context is invalid, return the default socket
   * location.
   * @param currentContext Docker's current context, as set in the configs.
   */
  protected async getCurrentDockerSocket(currentContext?: string): Promise<string> {
    if (os.platform().startsWith('win')) {
      throw new Error('getCurrentDockerSocket is not on Windows');
    }
    const defaultSocket = `unix://${ this.defaultDockerSockPath }`;

    if (!currentContext) {
      return defaultSocket;
    }

    for (const dir of await fs.promises.readdir(this.dockerContextDirPath)) {
      const contextPath = path.join(this.dockerContextDirPath, dir, 'meta.json');

      try {
        const data = yaml.parse(await fs.promises.readFile(contextPath, 'utf-8'));

        if (data.Name === currentContext) {
          return data.Endpoints?.docker?.Host as string ?? defaultSocket;
        }
      } catch (ex) {
        console.log(`Failed to read context ${ dir }, skipping: ${ ex }`);
      }
    }

    // If we reach here, the current context is invalid.
    return defaultSocket;
  }

  /**
   * Given some information about state external to this method, returns the
   * name of the context that should be used. Follows these rules, in order of preference:
   * 1. If we have control of the default socket (`/var/run/docker.sock`), return a value
   *    that refers to the default context, which uses the default socket.
   *    This should have the widest compatibility.
   * 2. Return the passed current context if:
   *    - The current context uses a valid unix socket - the user is probably using it.
   *    - The current context uses a non-unix socket (e.g. tcp) - we can't check if it's valid.
   * 3. The current context is invalid, so return our context ("rancher-desktop").
   * @param weOwnDefaultSocket Whether Rancher Desktop has control over the default socket.
   * @param currentContext The current context.
   * @returns Undefined for default context; string containing context name for other contexts.
   */
  async getDesiredDockerContext(weOwnDefaultSocket: boolean, currentContext: string | undefined): Promise<string | undefined> {
    if (weOwnDefaultSocket) {
      return undefined;
    }

    // As things are, we should not get past this point on Windows.
    if (os.platform().startsWith('win')) {
      throw new Error('must call getDesiredDockerContext with weOwnDefaultSocket === true on Windows');
    }

    if (!currentContext) {
      return this.contextName;
    }

    if (currentContext === this.contextName) {
      return this.contextName;
    }

    const currentSocketUri = await this.getCurrentDockerSocket(currentContext);

    if (!currentSocketUri.startsWith('unix://')) {
      // Using a non-unix socket (e.g. TCP); assume it's working fine.
      return currentContext;
    }

    const currentSocketPath = currentSocketUri.replace(/^unix:\/\//, '');

    try {
      if ((await fs.promises.stat(currentSocketPath)).isSocket()) {
        return currentContext;
      }
      console.log(`Invalid existing context "${ currentContext }": ${ currentSocketUri } is not a socket; overriding context.`);
    } catch (ex) {
      console.log(`Could not read existing docker socket ${ currentSocketUri }, overriding context "${ currentContext }": ${ ex }`);
    }

    return this.contextName;
  }

  protected async spawnFileWithExtraPath(command: string, args: string[]) {
    // The PATH needs to contain our resources directory (on macOS that would
    // not be in the application's PATH).
    // NOTE: This needs to match HttpCredentialHelperServer.

    const platform = os.platform();
    let pathVar = process.env.PATH ?? ''; // This should always be set.

    pathVar += path.delimiter + path.join(paths.resources, platform, 'bin');

    return await spawnFile(command, args, {
      env:   { ...process.env, PATH: pathVar },
      stdio: ['ignore', 'ignore', console],
    });
  }

  /**
   * docker-credential-pass will appear to work even when `pass` is not
   * initialized; this provides a more detailed test to see if it works.
   */
  protected async credHelperPassInitialized(): Promise<boolean> {
    try {
      const timeoutError = Symbol('timeout');
      const execPromise = this.spawnFileWithExtraPath('pass', ['ls']);
      const timeoutPromise = new Promise(resolve => setTimeout(() => resolve(timeoutError), 1_000));
      const result = await Promise.race([execPromise, timeoutPromise]);

      if (Object.is(result, timeoutError)) {
        console.debug('Timed out waiting for pass');

        return false;
      }

      return true;
    } catch (ex) {
      console.debug(`The pass command is not working; ignoring docker-credential-pass`);

      return false;
    }
  }

  /**
   * Determines whether the passed credential helper is working.
   * @param helperName The cred helper name, without the "docker-credential-" prefix.
   */
  protected async credHelperWorking(helperName: string): Promise<boolean> {
    const helperBin = `docker-credential-${ helperName }`;

    console.debug(`Checking if credential helper ${ helperName } is working...`);

    if (helperName === 'desktop') {
      // Special case docker-credentials-desktop: never use it.
      console.debug(`Rejecting ${ helperName }; blacklisted.`);

      return false;
    } else if (helperName === 'pass') {
      if (!await this.credHelperPassInitialized()) {
        console.debug(`Rejecting ${ helperName }; underlying library not initialized.`);

        return false;
      }
    }

    try {
      await this.spawnFileWithExtraPath(helperBin, ['list']);
      console.debug(`Credential helper ${ helperBin } is working.`);

      return true;
    } catch (err) {
      console.log(`Credential helper "${ helperBin }" is not functional: ${ err }`);

      return false;
    }
  }

  /**
   * Returns the default cred helper name for the current platform.
   */
  protected async getCredsStoreFor(currentCredsStore: string | undefined): Promise<string> {
    const platform = os.platform();

    // If the custom credential helper exists, use it.  Note that this may
    // sometimes fail if the user is in a shell with a different PATH than our
    // process, but we can't help with that right now.
    if (currentCredsStore && await this.credHelperWorking(currentCredsStore)) {
      return currentCredsStore;
    }
    // When running E2E tests in CI, use "none".  Note that we use the default
    // value when running unit tests in CI.
    const e2eInCI = process.env.CI && (process.env.RD_TEST ?? '').includes('e2e');

    if (e2eInCI && await this.credHelperWorking('none')) {
      return 'none';
    }

    if (platform.startsWith('win')) {
      return 'wincred';
    } else if (platform === 'darwin') {
      return 'osxkeychain';
    } else if (platform === 'linux') {
      // On Linux, we need to match the logic used by oras-go (used by helm):
      // If `pass` works, use it; otherwise use secret service.
      if (await this.credHelperWorking('pass')) {
        return 'pass';
      }
      return 'secretservice';
    } else {
      throw new Error(`platform "${ platform }" is not supported`);
    }
  }

  /**
   * Ensures that the rancher-desktop docker context exists.
   * @param socketPath Path to the rancher-desktop specific docker socket.
   */
  protected async ensureDockerContextFile(socketPath: string): Promise<void> {
    if (os.platform().startsWith('win')) {
      throw new Error('ensureDockerContextFile is not on Windows');
    }
    const contextContents = {
      Name:      this.contextName,
      Metadata:  { Description: 'Rancher Desktop moby context' },
      Endpoints: {
        docker: {
          Host:          `unix://${ socketPath }`,
          SkipTLSVerify: false,
        },
      },
    };

    console.debug(`Updating docker context: writing to ${ this.dockerContextPath }`, contextContents);

    await fs.promises.mkdir(path.dirname(this.dockerContextPath), { recursive: true });
    await fs.promises.writeFile(this.dockerContextPath, JSON.stringify(contextContents));
  }

  /**
   * Return the current docker context.
   */
  get currentDockerContext(): Promise<string | undefined> {
    return this.readDockerConfig().then(cfg => cfg.currentContext);
  }

  /**
   * Clear the docker context if we changed it for running without admin privileges
   */
  async clearDockerContext(): Promise<void> {
    try {
      await fs.promises.rm(path.dirname(this.dockerContextPath), {
        recursive: true, force: true, maxRetries: 3,
      });

      const config = await this.readDockerConfig();

      if (config?.currentContext !== this.contextName) {
        return;
      }
      delete config.currentContext;
      await this.writeDockerConfig(config);
    } catch (ex) {
      // Ignore the error; there really isn't much we can usefully do here.
      console.debug(`Ignoring error when clearing docker context: ${ ex }`);
    }
  }

  /**
   * Ensures that the Rancher Desktop context file exists, and that the docker context
   * is set in the config file according to our rules.
   * @param weOwnDefaultSocket Whether Rancher Desktop has control over the default socket.
   * @param socketPath Path to the rancher-desktop specific docker socket. Darwin/Linux only.
   */
  async ensureDockerContextConfigured(weOwnDefaultSocket: boolean, socketPath?: string): Promise<void> {
    // read current config
    const currentConfig = await this.readDockerConfig();

    // Deep-copy the JSON object
    const newConfig = clone(currentConfig);

    // ensure docker context is set as we want
    const platform = os.platform();

    if ((platform === 'darwin' || platform === 'linux') && socketPath) {
      await this.ensureDockerContextFile(socketPath);
    }
    newConfig.currentContext = await this.getDesiredDockerContext(weOwnDefaultSocket, currentConfig.currentContext);

    // write config if modified
    if (JSON.stringify(newConfig) !== JSON.stringify(currentConfig)) {
      await this.writeDockerConfig(newConfig);
    }

    // Trigger diagnostics, ignoring results.
    mainEvents.invoke('diagnostics-trigger', 'DOCKER_CONTEXT').catch(e => console.error(e));
  }

  /**
   * Ensures that the docker config file is configured with a valid credential helper.
   */
  async ensureCredHelperConfigured(): Promise<void> {
    // read current config
    const currentConfig = await this.readDockerConfig();

    // Deep-copy the JSON object
    const newConfig = clone(currentConfig);

    // ensure we are using one of our preferred credential helpers
    newConfig.credsStore = await this.getCredsStoreFor(currentConfig.credsStore);

    // write config if modified
    if (JSON.stringify(newConfig) !== JSON.stringify(currentConfig)) {
      await this.writeDockerConfig(newConfig);
    }
  }
}

/**
 * Export a singleton instance of the docker dir manager by default.
 */
export default new DockerDirManager(path.join(os.homedir(), '.docker'));
