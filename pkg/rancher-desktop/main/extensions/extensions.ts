import fs from 'fs';
import os from 'os';
import path from 'path';

import _ from 'lodash';

import {
  Extension, ExtensionError, ExtensionErrorCode, ExtensionErrorMarker, ExtensionMetadata,
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
  protected readonly extensionNamespace = 'rancher-desktop-extensions';

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
      await this.installContainers(metadata);
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

  /**
   * Extract the Docker Compose files into a newly-created temporary directory.
   * This is required because nerdctl doesn't seem to keep the definition around,
   * @note The caller is expected to remove the output directory.
   * @param composePath the value of metadata.vm.composefile
   */
  protected async extractComposeDefinition(composePath: string): Promise<string> {
    const workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'rd-ext-install-'));
    const composeDir = path.posix.dirname(path.posix.normalize(composePath));

    await this.client.copyFile(
      this.id,
      composeDir === '.' ? '/' : `${ composeDir }/`,
      workDir,
      { namespace: this.extensionNamespace });

    return workDir;
  }

  protected async installContainers(metadata: ExtensionMetadata): Promise<void> {
    if (isVMTypeImage(metadata.vm)) {
      // eslint-disable-next-line no-template-curly-in-string -- literal ${DESKTOP_PLUGIN_IMAGE}
      const imageID = metadata.vm.image === '${DESKTOP_PLUGIN_IMAGE}' ? this.id : metadata.vm.image;
      const stdout = await this.client.run(imageID, {
        namespace: this.extensionNamespace,
        name:      this.containerName,
        restart:   'always',
      });

      console.debug(`Running ${ this.id } container image ${ imageID }: ${ stdout.trim() }`);
    } else if (isVMTypeComposefile(metadata.vm)) {
      const workDir = await this.extractComposeDefinition(metadata.vm.composefile);

      try {
        console.debug(`Running ${ this.id } compose up (workDir=${ workDir })`);
        await this.client.composeUp(
          workDir,
          {
            name:      this.containerName,
            namespace: this.extensionNamespace,
            env:       { DESKTOP_PLUGIN_IMAGE: this.id },
          },
        );
      } finally {
        await fs.promises.rm(workDir, { recursive: true });
      }
    }
  }

  async uninstall(): Promise<boolean> {
    // TODO: Unregister the extension from the UI.

    try {
      const metadata = await this.metadata;

      await this.uninstallContainers(metadata);
    } catch (ex) {
      console.error(`Failed to read extension ${ this.id } metadata while uninstalling, not stopping containers: ${ ex }`);
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

  protected async uninstallContainers(metadata: ExtensionMetadata) {
    if (isVMTypeImage(metadata.vm)) {
      await this.client.stop(this.containerName, {
        namespace: this.extensionNamespace,
        force:     true,
        delete:    true,
      });
    } else if (isVMTypeComposefile(metadata.vm)) {
      const workDir = await this.extractComposeDefinition(metadata.vm.composefile);

      try {
        await this.client.composeDown(workDir, {
          name:      this.containerName,
          namespace: this.extensionNamespace,
          env:       { DESKTOP_PLUGIN_IMAGE: this.id },
        });
      } finally {
        await fs.promises.rm(workDir, { recursive: true });
      }
    }
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
