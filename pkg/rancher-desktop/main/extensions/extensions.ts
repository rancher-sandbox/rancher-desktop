import { ChildProcessByStdio } from 'child_process';
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';

import _ from 'lodash';
import yaml from 'yaml';

import {
  Extension, ExtensionError, ExtensionErrorCode, ExtensionErrorMarker, ExtensionMetadata, SpawnOptions,
} from './types';

import type { ContainerEngineClient } from '@pkg/backend/containerClient';
import mainEvents from '@pkg/main/mainEvents';
import Logging from '@pkg/utils/logging';
import paths from '@pkg/utils/paths';
import { defined } from '@pkg/utils/typeUtils';

const console = Logging.extensions;

class ExtensionErrorImpl extends Error implements ExtensionError {
  [ExtensionErrorMarker] = 0;
  code: ExtensionErrorCode;

  constructor(code: ExtensionErrorCode, message: string, cause?: Error) {
    // XXX We're currently using a version of TypeScript that doesn't have the
    // ES2022.Error lib, so it does't understand the "cause" option to the Error
    // constructor.  Work around this by explicitly calling setting the cause.
    // It appears to still be printed in that case.
    super(message);
    if (cause) {
      (this as any).cause = cause;
    }
    this.code = code;
  }
}

/**
 * isVMTypeImage asserts that a ExtensionMetadata.vm is an image.
 */
function isVMTypeImage(input: ExtensionMetadata['vm']): input is { image: string } {
  return typeof (input as any)?.image === 'string';
}

/**
 * isVMTypeComposefile asserts that a ExtensionMetadata.vm is a composefile.
 */
function isVMTypeComposefile(input: ExtensionMetadata['vm']): input is { composefile: string } {
  return typeof (input as any)?.composefile === 'string';
}

export class ExtensionImpl implements Extension {
  constructor(id: string, client: ContainerEngineClient) {
    const encodedId = Buffer.from(id, 'utf-8').toString('base64url');

    this.id = id;
    this.client = client;
    this.dir = path.join(paths.extensionRoot, encodedId);
  }

  /** The extension ID (the image ID) */
  id: string;
  /** The directory this extension will be installed into */
  readonly dir: string;
  protected readonly client: ContainerEngineClient;
  protected _metadata: Promise<ExtensionMetadata> | undefined;
  /** The (nerdctl) namespace to use; shared with ExtensionManagerImpl */
  static readonly extensionNamespace = 'rdx';
  protected get extensionNamespace() {
    return ExtensionImpl.extensionNamespace;
  }

  /** Extension metadata */
  get metadata(): Promise<ExtensionMetadata> {
    this._metadata ??= (async() => {
      const fallback = { vm: {} };

      try {
        const raw = await this.readFile('metadata.json');
        const result = _.merge({}, fallback, JSON.parse(raw));

        if (!result.icon) {
          throw new ExtensionErrorImpl(ExtensionErrorCode.INVALID_METADATA, 'Invalid extension: missing icon');
        }

        return result;
      } catch (ex: any) {
        console.error(`Failed to read metadata for ${ this.id }: ${ ex }`);
        // Unset metadata so we can try again later
        this._metadata = undefined;
        throw new ExtensionErrorImpl(ExtensionErrorCode.INVALID_METADATA, 'Could not read extension metadata', ex);
      }
    })();

    return this._metadata as Promise<ExtensionMetadata>;
  }

  protected _iconName: Promise<string> | undefined;

  /** iconName is the file name of the icon (e.g. icon.png, icon.svg) */
  get iconName(): Promise<string> {
    this._iconName ??= (async() => {
      return `icon${ path.extname((await this.metadata).icon) }`;
    })();

    return this._iconName as Promise<string>;
  }

  async install(): Promise<boolean> {
    const metadata = await this.metadata;

    await fs.promises.mkdir(this.dir, { recursive: true });
    try {
      await this.installMetadata(this.dir, metadata);
      await this.installIcon(this.dir, metadata);
      await this.installUI(this.dir, metadata);
      await this.installHostExecutables(this.dir, metadata);
      await this.installContainers(this.dir, metadata);
    } catch (ex) {
      console.error(`Failed to install extension ${ this.id }, cleaning up:`, ex);
      await fs.promises.rm(this.dir, { recursive: true }).catch((e) => {
        console.error(`Failed to cleanup extension directory ${ this.dir }`, e);
      });
      throw ex;
    }

    mainEvents.emit('settings-write', { extensions: { [this.id]: true } });

    // TODO: Do something so the extension is recognized by the UI.
    console.debug(`Install ${ this.id }: install complete.`);

    return true;
  }

  protected installMetadata(workDir: string, metadata: ExtensionMetadata): Promise<void> {
    return fs.promises.writeFile(
      path.join(workDir, 'metadata.json'),
      JSON.stringify(metadata, undefined, 2));
  }

  protected async installIcon(workDir: string, metadata: ExtensionMetadata): Promise<void> {
    try {
      const origIconName = path.basename(metadata.icon);

      try {
        await this.client.copyFile(this.id, metadata.icon, workDir, { namespace: this.extensionNamespace });
      } catch (ex) {
        throw new ExtensionErrorImpl(ExtensionErrorCode.FILE_NOT_FOUND, `Could not copy icon file ${ metadata.icon }`, ex as Error);
      }
      if (origIconName !== await this.iconName) {
        await fs.promises.rename(path.join(workDir, origIconName), path.join(workDir, await this.iconName));
      }
    } catch (ex) {
      console.error(`Could not copy icon for extension ${ this.id }: ${ ex }`);
      throw ex;
    }
  }

  protected async installUI(workDir: string, metadata: ExtensionMetadata): Promise<void> {
    if (!metadata.ui) {
      return;
    }

    const uiDir = path.join(workDir, 'ui');

    await fs.promises.mkdir(uiDir, { recursive: true });
    await Promise.all(Object.entries(metadata.ui).map(async([name, data]) => {
      try {
        await fs.promises.mkdir(path.join(uiDir, name), { recursive: true });
        await this.client.copyFile(
          this.id,
          data.root,
          path.join(uiDir, name),
          { namespace: this.extensionNamespace });
      } catch (ex: any) {
        throw new ExtensionErrorImpl(ExtensionErrorCode.FILE_NOT_FOUND, `Could not copy UI ${ name }`, ex);
      }
    }));
  }

  protected async installHostExecutables(workDir: string, metadata: ExtensionMetadata): Promise<void> {
    const plat: 'windows' | 'linux' | 'darwin' = (() => {
      switch (process.platform) {
      case 'win32':
        return 'windows';
      case 'linux':
      case 'darwin':
        return process.platform;
      default:
        throw new Error(`Platform ${ process.platform } is not supported`);
      }
    })();
    const binDir = path.join(workDir, 'bin');

    await fs.promises.mkdir(binDir, { recursive: true });
    const binaries = metadata.host?.binaries ?? [];
    const paths = binaries.flatMap(p => p[plat]).map(b => b?.path).filter(defined);

    await Promise.all(paths.map(async(p) => {
      try {
        await this.client.copyFile(this.id, p, binDir, { namespace: this.extensionNamespace });
      } catch (ex: any) {
        throw new ExtensionErrorImpl(ExtensionErrorCode.FILE_NOT_FOUND, `Could not copy host binary ${ p }`, ex);
      }
    }));
  }

  get containerName() {
    const normalizedId = this.id.toLowerCase().replaceAll(/[^a-z0-9_-]/g, '_');

    return `rd-extension-${ normalizedId }`;
  }

  protected async installContainers(workDir: string, metadata: ExtensionMetadata): Promise<void> {
    const composeDir = path.join(workDir, 'compose');
    let contents: any;

    // Extract compose file and place it in composeDir
    if (isVMTypeImage(metadata.vm)) {
      contents = {
        name:     this.id,
        // Disable lint because it's a literal ${DESKTOP_PLUGIN_IMAGE} string.
        // eslint-disable-next-line no-template-curly-in-string
        services: { web: { image: '${DESKTOP_PLUGIN_IMAGE}' } },
      };

      await fs.promises.mkdir(composeDir, { recursive: true });
      await fs.promises.writeFile(path.join(composeDir, 'compose.yaml'), JSON.stringify(contents));
    } else if (isVMTypeComposefile(metadata.vm)) {
      const imageComposeDir = path.posix.dirname(path.posix.normalize(metadata.vm.composefile));

      await fs.promises.mkdir(composeDir, { recursive: true });
      await this.client.copyFile(
        this.id,
        imageComposeDir === '.' ? '/' : `${ imageComposeDir }/`,
        composeDir,
        { namespace: this.extensionNamespace });

      const composeNames = ['compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml'];

      for (const composeName of composeNames) {
        try {
          contents = yaml.parse(await fs.promises.readFile(path.join(composeDir, composeName), 'utf-8'));
          break;
        } catch (ex) {
          /* Try the next file, or fall back to nothing */
        }
      }
    } else {
      console.debug(`Extension ${ this.id } does not have containers to run.`);

      return;
    }

    if (metadata.vm.exposes?.socket) {
      _.merge(contents, {
        services: {
          'r-d-x-port-forwarding': {
            image:       'ghcr.io/rancher-sandbox/rancher-desktop/rdx-proxy:latest',
            environment: { SOCKET: `/run/guest-services/${ metadata.vm.exposes.socket }` },
            ports:       ['80'],
          },
        },
        volumes: { 'r-d-x-guest-services': { labels: { 'io.rancherdesktop.type': 'guest-services' } } },
      });

      // Fix up the compose file to always have a volume at /run/guest-services/
      // so that it can be used for sockets to be exposed.
      for (const service of Object.values<any>(contents.services)) {
        service.volumes ??= [];
        service.volumes.push({
          type:   'volume',
          source: 'r-d-x-guest-services',
          target: '/run/guest-services',
          volume: { nocopy: true },
        });
      }

      // Write out the modified compose file, either clobbering the original or
      // using the preferred name and shadowing the original.
      await fs.promises.writeFile(path.join(composeDir, 'compose.yaml'), yaml.stringify(contents));
    }

    // Run `ctrctl compose up`
    console.debug(`Running ${ this.id } compose up`);
    await this.client.composeUp(
      composeDir,
      {
        name:      this.containerName,
        namespace: this.extensionNamespace,
        env:       { DESKTOP_PLUGIN_IMAGE: this.id },
      },
    );
  }

  async uninstall(): Promise<boolean> {
    // TODO: Unregister the extension from the UI.

    try {
      await this.uninstallContainers();
    } catch (ex) {
      console.error(`Ignoring error stopping ${ this.id } containers on uninstall: ${ ex }`);
    }

    try {
      await fs.promises.rm(this.dir, { recursive: true });
    } catch (ex: any) {
      if ((ex as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw ex;
      }
    }

    mainEvents.emit('settings-write', { extensions: { [this.id]: false } });

    return true;
  }

  protected async uninstallContainers() {
    console.debug(`Running ${ this.id } compose down`);
    await this.client.composeDown(
      path.join(this.dir, 'compose'),
      {
        name:      this.containerName,
        namespace: this.extensionNamespace,
        env:       { DESKTOP_PLUGIN_IMAGE: this.id },
      },
    );
  }

  _composeFile: Promise<any> | undefined;
  get composeFile(): Promise<any> {
    this._composeFile ??= (async() => {
      // Because we wrote out `compose.yaml` in installContainers(), we
      // can assume that name.

      const filePath = path.join(this.dir, 'compose', 'compose.yaml');

      return yaml.parse(await fs.promises.readFile(filePath, 'utf-8'));
    })();

    return this._composeFile as Promise<any>;
  }

  async getBackendPort() {
    const portInfo = await this.client.composePort(
      path.join(this.dir, 'compose'), {
        name:      this.containerName,
        namespace: this.extensionNamespace,
        env:       { DESKTOP_PLUGIN_IMAGE: this.id },
        service:   'r-d-x-port-forwarding',
        port:      80,
        protocol:  'tcp',
      });

    // The port info looks like "0.0.0.0:1234", return only the port number.
    return /:(\d+)$/.exec(portInfo)?.[1];
  }

  async composeExec(options: SpawnOptions): Promise<ChildProcessByStdio<null, Readable, Readable>> {
    const metadata = await this.metadata;

    if (!isVMTypeImage(metadata.vm) && !isVMTypeComposefile(metadata.vm)) {
      throw new Error(`Could not run exec, extension ${ this.id } does not have containers`);
    }

    const composeData = await this.composeFile;
    const service = Object.keys(composeData?.services ?? {}).shift();

    if (!service) {
      throw new Error('No services found, cannot run exec');
    }

    return this.client.composeExec(path.join(this.dir, 'compose'), {
      name:      this.containerName,
      namespace: this.extensionNamespace,
      env:       { ...options.env, DESKTOP_PLUGIN_IMAGE: this.id },
      service,
      command:   options.command,
      ...options.cwd ? { workdir: options.cwd } : {},
    });
  }

  async extractFile(sourcePath: string, destinationPath: string): Promise<void> {
    await this.client.copyFile(
      this.id,
      sourcePath,
      destinationPath,
      { namespace: this.extensionNamespace });
  }

  async readFile(sourcePath: string): Promise<string> {
    return await this.client.readFile(this.id, sourcePath, { namespace: this.extensionNamespace });
  }
}
