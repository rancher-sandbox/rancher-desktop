import fs from 'fs';
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

  /** Extension metadata */
  get metadata(): Promise<ExtensionMetadata> {
    this._metadata ??= (async() => {
      const fallback = { vm: {} };

      try {
        const raw = await this.client.readFile(this.id, 'metadata.json');
        const result = _.merge({}, fallback, JSON.parse(raw));

        if (!result.icon) {
          throw new ExtensionErrorImpl(ExtensionErrorCode.INVALID_METADATA, 'Invalid extension: missing icon');
        }

        return result;
      } catch (ex: any) {
        console.error(`Failed to read metadata for ${ this.id }: ${ ex }`);
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

    function isRejectedResult<T>(result: PromiseSettledResult<T>): result is PromiseRejectedResult {
      return result.status === 'rejected';
    }

    await fs.promises.mkdir(this.dir, { recursive: true });
    const results = await Promise.allSettled([
      this.installMetadata(this.dir, metadata),
      this.installIcon(this.dir, metadata),
      this.installUI(this.dir, metadata),
      this.installHostExecutables(this.dir, metadata),
    ]);
    const failure = results.find(isRejectedResult);

    if (failure) {
      console.error(`Failed to install extension ${ this.id }, cleaning up:`, failure.reason);
      await fs.promises.rm(this.dir, { recursive: true }).catch((e) => {
        console.error(`Failed to cleanup extension directory ${ this.dir }`, e);
      });
      throw failure.reason;
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

      await this.client.copyFile(this.id, metadata.icon, workDir);
      if (origIconName !== await this.iconName) {
        await fs.promises.rename(path.join(workDir, origIconName), path.join(workDir, await this.iconName));
      }
    } catch (ex) {
      console.error(`Could not copy icon for extension ${ this.id }: ${ ex }`);
      if ((ex as NodeJS.ErrnoException)?.code === 'ENOENT') {
        throw new ExtensionErrorImpl(ExtensionErrorCode.FILE_NOT_FOUND, `Could not copy icon file ${ metadata.icon }`, ex as Error);
      }
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
        await this.client.copyFile(this.id, data.root, path.join(uiDir, name));
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
        await this.client.copyFile(this.id, p, binDir);
      } catch (ex: any) {
        throw new ExtensionErrorImpl(ExtensionErrorCode.FILE_NOT_FOUND, `Could not copy host binary ${ p }`, ex);
      }
    }));
  }

  async uninstall(): Promise<boolean> {
    // TODO: Unregister the extension from the UI.

    try {
      const metadata = await this.metadata;
      const vm = metadata.vm;

      if ('image' in vm) {
        console.error('Todo: stop container');
      } else if ('composefile' in vm) {
        console.error(`Skipping uninstall of compose file when uninstalling ${ this.id }`);
      }
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

  async extractFile(sourcePath: string, destinationPath: string): Promise<void> {
    await this.client.copyFile(this.id, sourcePath, destinationPath);
  }

  async readFile(sourcePath: string): Promise<string> {
    return await this.client.readFile(this.id, sourcePath);
  }
}
