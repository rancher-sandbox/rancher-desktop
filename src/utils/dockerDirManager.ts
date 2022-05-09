import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import yaml from 'yaml';
import Logging from '@/utils/logging';

const console = Logging.background;

type AuthConfig = {
  username?: string,
  password?: string,
  auth?: string,
  email?: string,
  serveraddress?: string,
  identitytoken?: string,
  registrytoken?: string,
}

type PartialDockerConfig = {
  auths?: Record<string, AuthConfig>,
  credsStore?: string,
  credHelpers?: Record<string, string>,
  currentContext?: string,
}

export default class DockerDirManager {
  protected readonly dockerDirPath: string;
  /**
   * Path to the 'rancher-desktop' docker context directory.  The last component
   * is the SHA256 hash of the docker context name ('rancher-desktop'), per the
   * docker convention.
   */
  protected readonly dockerContextPath: string;
  protected contextName = 'rancher-desktop'
  protected defaultDockerSockLocation = '/var/run/docker.sock';

  constructor(dockerDirPath: string) {
    this.dockerDirPath = dockerDirPath;
    this.dockerContextPath = path.join(this.dockerDirPath, 'contexts', 'meta',
      'b547d66a5de60e5f0843aba28283a8875c2ad72e99ba076060ef9ec7c09917c8');
  }

  protected async readDockerConfig(): Promise<PartialDockerConfig> {
    const configPath = path.join(this.dockerDirPath, 'config.json');
    const rawConfig = await fs.promises.readFile(configPath, { encoding: 'utf-8' });
    return JSON.parse(rawConfig);
  }

  async updateDockerContext(socketPath: string, kubernetesEndpoint?: string, defaultSocket = false): Promise<void> {
    await this.ensureDockerContext(socketPath, kubernetesEndpoint)
    await this.setDockerContext(defaultSocket);
  }

  /**
   * Ensures that the rancher-desktop docker context exists.
   * @param socketPath Path to the rancher-desktop specific docker socket.
   * @param kubernetesEndpoint Path to rancher-desktop Kubernetes endpoint.
   */
  async ensureDockerContext(socketPath: string, kubernetesEndpoint?: string): Promise<void> {
    const contextContents = {
      Name:      this.contextName,
      Metadata:  { Description: 'Rancher Desktop moby context' },
      Endpoints: {
        docker: {
          Host:          `unix://${ socketPath }`,
          SkipTLSVerify: false,
        },
      } as Record<string, {Host: string, SkipTLSVerify: boolean, DefaultNamespace?: string}>,
    };

    if (kubernetesEndpoint) {
      contextContents.Endpoints.kubernetes = {
        Host:             kubernetesEndpoint,
        SkipTLSVerify:    true,
        DefaultNamespace: 'default',
      };
    }

    console.debug(`Updating docker context: writing to ${ this.dockerContextPath }`, contextContents);

    await fs.promises.mkdir(this.dockerContextPath, { recursive: true });
    await fs.promises.writeFile(path.join(this.dockerContextPath, 'meta.json'), JSON.stringify(contextContents));
  }

  /**
   * Read the docker configuration, and return the docker socket in use by the
   * current context.  If the context is invalid, return the default socket
   * location.
   * @param currentContext docker's current context, as set in the configs.
   */
  protected async getCurrentDockerSocket(currentContext?: string): Promise<string> {
    const defaultSocket = `unix://${ this.defaultDockerSockLocation }`;
    const contextParent = path.dirname(this.dockerContextPath);

    if (!currentContext) {
      return defaultSocket;
    }

    for (const dir of await fs.promises.readdir(contextParent)) {
      const dirPath = path.join(contextParent, dir, 'meta.json');

      try {
        const data = yaml.parse(await fs.promises.readFile(dirPath, 'utf-8'));

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
   * 1. If we have control of the default socket (`/var/run/docker.sock`), we should set the
   *    context to it (which is actually un-setting the `currentContext` key).
   *    This should have the widest compatibility.
   * 2. Otherwise, check the current context and don't change anything if any of the following
   *    is true:
   *    - The current context uses a valid unix socket - the user is probably using it.
   *    - The current context uses a non-unix socket (e.g. tcp) - we can't check if it's valid.
   * 3. The current context is invalid - set the current context to our (rancher-desktop) context.
   * @param currentContext the current context
   * @param weOwnDefaultSocket whether Rancher Desktop has control over the default socket
   */
  async getDesiredDockerContext(currentContext?: string, weOwnDefaultSocket = false): Promise<string | undefined> {
    if (weOwnDefaultSocket) {
      return undefined;
    }

    if (!currentContext && !weOwnDefaultSocket) {
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
      console.log(`Invalid current context "${ currentContext }": ${ currentSocketUri } is not a socket; overriding context.`);
    } catch (ex) {
      console.log(`Could not read current docker socket ${ currentSocketUri }, overriding context "${ currentContext }": ${ ex }`);
    }

    return this.contextName;
  }

  /**
   * Clear the docker context; this is used for factory reset.
   */
  async clearDockerContext(): Promise<void> {
    const configPath = path.join(this.dockerContextPath, '../../../config.json');

    try {
      await fs.promises.rm(this.dockerContextPath, { recursive: true, force: true });

      const existingConfig: {currentContext?: string} =
        JSON.parse(await fs.promises.readFile(configPath, { encoding: 'utf-8' })) ?? {};

      if (existingConfig?.currentContext !== this.contextName) {
        return;
      }
      delete existingConfig.currentContext;
      await fs.promises.writeFile(configPath, JSON.stringify(existingConfig));
    } catch (ex) {
      // Ignore the error; there really isn't much we can usefully do here.
      console.debug(`Ignoring error when clearing docker context: ${ ex }`);
    }
  }

  getDefaultDockerCredsStore(): string {
    let platform = os.platform()
    if (platform.startsWith('win')) {
      return 'wincred';
    } else if (platform === 'darwin') {
      return 'osxkeychain';
    } else if (platform === 'linux') {
      return 'secretservice';
    }{
      throw new Error(`platform "${ platform }" is not supported`);
    }
  }

  async dockerDesktopCredHelperWorking(passedHelperPath?: string): Promise<boolean> {
    const helperPath = passedHelperPath ?? 'docker-credential-desktop';
    let proc: any;
    try {
      proc = spawn(helperPath, ['list']);
    } catch {
      return false;
    }

    return await new Promise( (resolve) => {
      proc.on('exit', (code: number) => {
        resolve(!code);
      });
    });
  }

  async ensureDockerConfig(): Promise<void> {
    const dockerConfigPath = path.join(os.homedir(), '.docker', 'config.json')
    let dockerConfig: PartialDockerConfig = {};
    try {
      dockerConfig = JSON.parse(await fs.promises.readFile(dockerConfigPath, 'utf8'));
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }

    let configChanged = false;
    if (!dockerConfig.credsStore) {
      dockerConfig.credsStore = this.getDefaultDockerCredsStore();
      configChanged = true;
    } else if (dockerConfig.credsStore === 'desktop' && !this.dockerDesktopCredHelperWorking()) {
      dockerConfig.credsStore = this.getDefaultDockerCredsStore();
      configChanged = true;
    }
    if (configChanged) {
      await fs.promises.writeFile(dockerConfigPath, JSON.stringify(dockerConfig));
    }
  }

}
