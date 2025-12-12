import { ChildProcessByStdio, spawn } from 'child_process';
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
import { spawnFile } from '@pkg/utils/childProcess';
import { parseImageReference } from '@pkg/utils/dockerUtils';
import Logging from '@pkg/utils/logging';
import paths from '@pkg/utils/paths';
import { defined } from '@pkg/utils/typeUtils';

/**
 * ComposeFile describes the contents of a compose file.
 * @note The typing here is incomplete.
 */
interface ComposeFile {
  name?:    string;
  services: Record<string, {
    image?:       string;
    environment?: string[];
    command?:     string;
    volumes?: (string | {
      type:       string;
      source?:    string;
      target:     string;
      read_only?: boolean;
      bind?: {
        propagation?:      string;
        create_host_path?: boolean;
        selinux?:          'z' | 'Z';
      };
      volume?:      { nocopy?: boolean };
      tmpfs?:       { size?: number | string; mode?: number };
      consistency?: string;
    })[];
  }>;
  volumes?: Record<string, any>;
}

// ScriptType is any key in ExtensionMetadata.host that starts with `x-rd-`.
type ScriptType = keyof {
  [K in keyof Required<ExtensionMetadata>['host'] as K extends `x-rd-${ infer _U }` ? K : never]: 1;
};

const console = Logging.extensions;

export class ExtensionErrorImpl extends Error implements ExtensionError {
  [ExtensionErrorMarker] = 0;
  code: ExtensionErrorCode;

  constructor(code: ExtensionErrorCode, message: string, cause?: Error) {
    // XXX We're currently using a version of TypeScript that doesn't have the
    // ES2022.Error lib, so it doesn't understand the "cause" option to the
    // Error constructor.  Work around this by explicitly calling setting the
    // cause.  It appears to still be printed in that case.
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
  constructor(id: string, tag: string, client: ContainerEngineClient) {
    const encodedId = Buffer.from(id, 'utf-8').toString('base64url');

    this.id = id;
    this.version = tag;
    this.client = client;
    this.dir = path.join(paths.extensionRoot, encodedId);
  }

  /** The extension ID (the image ID), excluding the tag */
  id:                        string;
  /** The extension image tag */
  version:                   string;
  /** The directory this extension will be installed into */
  readonly dir:              string;
  protected readonly client: ContainerEngineClient;
  protected _metadata:       Promise<ExtensionMetadata> | undefined;
  protected _labels:         Promise<Record<string, string>> | undefined;
  /** The (nerdctl) namespace to use; shared with ExtensionManagerImpl */
  static readonly extensionNamespace = 'rancher-desktop-extensions';
  protected readonly VERSION_FILE = 'version.txt';
  protected get extensionNamespace() {
    return ExtensionImpl.extensionNamespace;
  }

  get image() {
    return `${ this.id }:${ this.version }`;
  }

  /** Extension metadata */
  get metadata(): Promise<ExtensionMetadata> {
    this._metadata ??= (async() => {
      const fallback = { vm: {} };

      try {
        const raw = await this.readFile('metadata.json');
        const result = _.merge({}, fallback, JSON.parse(raw));

        if (result.icon) {
          return result;
        }
      } catch (ex: any) {
        console.error(`Failed to read metadata for ${ this.id }: ${ ex }`);
        // Unset metadata so we can try again later
        this._metadata = undefined;
        throw new ExtensionErrorImpl(ExtensionErrorCode.INVALID_METADATA, 'Could not read extension metadata', ex);
      }
      // If we reach here, we got the metadata but there was no icon set.
      // There's no point in retrying in that case.
      throw new ExtensionErrorImpl(ExtensionErrorCode.INVALID_METADATA, 'Invalid extension: missing icon');
    })();

    return this._metadata;
  }

  /** Extension image labels */
  get labels(): Promise<Record<string, string>> {
    this._labels ??= (async() => {
      try {
        if (await this.isInstalled()) {
          const labelPath = path.join(this.dir, 'labels.json');

          return JSON.parse(await fs.promises.readFile(labelPath, 'utf-8'));
        }

        const info = await this.client.runClient(
          ['image', 'inspect', '--format={{ json .Config.Labels }}', this.image],
          'pipe',
          { namespace: ExtensionImpl.extensionNamespace });

        return JSON.parse(info.stdout);
      } catch (ex: any) {
        // Unset cached value so we can try again later
        this._labels = undefined;
        throw new ExtensionErrorImpl(ExtensionErrorCode.INVALID_METADATA, 'Could not read image labels', ex);
      }
    })();

    return this._labels;
  }

  protected _iconName: Promise<string> | undefined;

  /** iconName is the file name of the icon (e.g. icon.png, icon.svg) */
  get iconName(): Promise<string> {
    this._iconName ??= (async() => {
      return `icon${ path.extname((await this.metadata).icon) }`;
    })();

    return this._iconName;
  }

  /**
   * Check if the given image is allowed to be installed according to the
   * extension allow list.
   * @throws If the image is not allowed to be installed.
   */
  protected static checkInstallAllowed(allowedImages: readonly string[] | undefined, image: string) {
    const desired = parseImageReference(image);
    const code = ExtensionErrorCode.INSTALL_DENIED;
    const prefix = `Disallowing install of ${ image }:`;

    if (!desired) {
      throw new ExtensionErrorImpl(code, `${ prefix } Invalid image reference`);
    }
    if (!allowedImages) {
      return;
    }
    for (const pattern of allowedImages) {
      const allowed = parseImageReference(pattern, true);

      if (allowed?.tag && allowed.tag !== desired.tag) {
        // This pattern doesn't match the tag, look for something else.
        continue;
      }

      if (allowed?.registry.href !== desired.registry.href) {
        // This pattern has a different registry
        continue;
      }

      if (!allowed.name) {
        // If there's no name given, the whole registry is allowed.
        return '';
      }

      if (allowed.name.endsWith('/')) {
        if (desired.name.startsWith(allowed.name)) {
          // The allowed pattern ends with a slash, anything in the org is fine.
          return '';
        }
      } else if (allowed.name === desired.name) {
        return '';
      }
    }

    throw new ExtensionErrorImpl(code, `${ prefix } Image is not allowed`);
  }

  /**
   * Determine the post-install or pre-uninstall script to run, if any.
   * Returns the script executable plus arguments; the executable path is always
   * absolute.
   */
  protected getScriptArgs(metadata: ExtensionMetadata, key: ScriptType): string[] | undefined {
    const scriptData = metadata.host?.[key]?.[this.platform];

    if (!scriptData) {
      return;
    }

    const [scriptName, ...scriptArgs] = Array.isArray(scriptData) ? scriptData : [scriptData];
    const description = {
      'x-rd-install':   'Post-install',
      'x-rd-uninstall': 'Pre-uninstall',
      'x-rd-shutdown':  'Shutdown',
    }[key];
    const binDir = path.join(this.dir, 'bin');
    const scriptPath = path.normalize(path.resolve(binDir, scriptName));

    if (/^\.+[/\\]/.test(path.relative(binDir, scriptPath))) {
      throw new Error(`${ description } script for ${ this.id } (${ scriptName }) not inside binaries directory`);
    }

    return [scriptPath, ...scriptArgs];
  }

  async install(allowedImages: readonly string[] | undefined): Promise<boolean> {
    const metadata = await this.metadata;

    ExtensionImpl.checkInstallAllowed(allowedImages, this.image);
    console.debug(`Image ${ this.image } is allowed to install: ${ allowedImages }`);

    await fs.promises.mkdir(this.dir, { recursive: true });
    try {
      await this.installMetadata(this.dir, metadata);
      await this.installIcon(this.dir, metadata);
      await this.installUI(this.dir, metadata);
      await this.installHostExecutables(this.dir, metadata);
      await this.installContainers(this.dir, metadata);
      await this.markInstalled(this.dir);
    } catch (ex) {
      console.error(`Failed to install extension ${ this.id }, cleaning up:`, ex);
      await fs.promises.rm(this.dir, { recursive: true, maxRetries: 3 }).catch((e) => {
        console.error(`Failed to cleanup extension directory ${ this.dir }`, e);
      });
      throw ex;
    }

    mainEvents.emit('settings-write', { application: { extensions: { installed: { [this.id]: this.version } } } });

    try {
      const [scriptPath, ...scriptArgs] = this.getScriptArgs(metadata, 'x-rd-install') ?? [];

      if (scriptPath) {
        console.log(`Running ${ this.id } post-install script: ${ scriptPath } ${ scriptArgs.join(' ') }...`);
        await spawnFile(scriptPath, scriptArgs, { stdio: console, cwd: path.dirname(scriptPath) });
      }
    } catch (ex) {
      console.error(`Ignoring error running ${ this.id } post-install script: ${ ex }`);
    }

    // Since we now run extensions in a separate session, register the protocol handler there.
    const encodedId = Buffer.from(this.id).toString('hex');

    await mainEvents.invoke('extensions/register-protocol', `persist:rdx-${ encodedId }`);

    console.debug(`Install ${ this.id }: install complete.`);

    return true;
  }

  protected async installMetadata(workDir: string, metadata: ExtensionMetadata): Promise<void> {
    await Promise.all([
      fs.promises.writeFile(
        path.join(workDir, 'metadata.json'),
        JSON.stringify(metadata, undefined, 2)),
      fs.promises.writeFile(
        path.join(workDir, 'labels.json'),
        JSON.stringify(await this.labels, undefined, 2)),
    ]);
  }

  protected async installIcon(workDir: string, metadata: ExtensionMetadata): Promise<void> {
    try {
      const origIconName = path.basename(metadata.icon);

      try {
        await this.client.copyFile(this.image, metadata.icon, workDir, { namespace: this.extensionNamespace });
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

        if (!data?.root) {
          throw new Error('Error: installUI - data.root is undefined');
        }

        await this.client.copyFile(
          this.image,
          data.root,
          path.join(uiDir, name),
          { namespace: this.extensionNamespace });
      } catch (ex: any) {
        throw new ExtensionErrorImpl(ExtensionErrorCode.FILE_NOT_FOUND, `Could not copy UI ${ name }`, ex);
      }
    }));
  }

  protected get platform() {
    switch (process.platform) {
    case 'win32':
      return 'windows';
    case 'linux':
    case 'darwin':
      return process.platform;
    default:
      throw new Error(`Platform ${ process.platform } is not supported`);
    }
  }

  protected async installHostExecutables(workDir: string, metadata: ExtensionMetadata): Promise<void> {
    const binDir = path.join(workDir, 'bin');

    await fs.promises.mkdir(binDir, { recursive: true });
    const binaries = metadata.host?.binaries ?? [];
    const paths = binaries.flatMap(p => p[this.platform]).map(b => b?.path).filter(defined);

    await Promise.all(paths.map(async(p) => {
      try {
        await this.client.copyFile(this.image, p, binDir, { namespace: this.extensionNamespace });
      } catch (ex: any) {
        throw new ExtensionErrorImpl(ExtensionErrorCode.FILE_NOT_FOUND, `Could not copy host binary ${ p }`, ex);
      }
    }));
  }

  protected async getComposeName() {
    if (this._composeName) {
      return this._composeName;
    }

    const normalizedId = this.id.toLowerCase().replaceAll(/[^a-z0-9_-]/g, '_');
    const contents = await this.getComposeFileContents();
    let composeName = `rd-extension-${ normalizedId }`;

    const maxServiceLength = Math.max(...Object.keys(contents.services).map(n => n.length));

    // On nerdctl, container names are something like:
    // <this.composeName>_<compose .services.*>_<counter>
    // If this string is longer than 76 characters, installation will fail.
    if (composeName.length + maxServiceLength + 4 > 76) {
      composeName = normalizedId.slice(0, 76 - maxServiceLength - 4);
    }

    this._composeName = composeName;

    return composeName;
  }

  /** memoized result of getComposeName() */
  protected _composeName = '';

  /**
   * Return the contents of the compose file.
   */
  protected async getComposeFileContents(): Promise<ComposeFile> {
    if (await this.isInstalled()) {
      const composePath = path.join(this.dir, 'compose', 'compose.yaml');

      return yaml.parse(await fs.promises.readFile(composePath, 'utf-8'));
    }

    const metadata = await this.metadata;

    if (isVMTypeImage(metadata.vm)) {
      // Only an image was specified, make up a compose file.
      return {
        name:     this.id.replace(/[^a-z0-9_-]/g, '_'),
        // Disable lint because it's a literal ${DESKTOP_PLUGIN_IMAGE} string.
        // eslint-disable-next-line no-template-curly-in-string
        services: { web: { image: '${DESKTOP_PLUGIN_IMAGE}' } },
      };
    }
    if (isVMTypeComposefile(metadata.vm)) {
      const composePath = path.posix.normalize(metadata.vm.composefile);
      const opts = { namespace: this.extensionNamespace };

      return yaml.parse(await this.client.readFile(this.image, composePath, opts));
    }
    throw new Error(`Invalid vm type`);
  }

  protected async installContainers(workDir: string, metadata: ExtensionMetadata): Promise<void> {
    const composeDir = path.join(workDir, 'compose');
    let contents: ComposeFile;

    // Extract compose file and place it in composeDir
    if (isVMTypeImage(metadata.vm)) {
      contents = await this.getComposeFileContents();
      await fs.promises.mkdir(composeDir, { recursive: true });
    } else if (isVMTypeComposefile(metadata.vm)) {
      const imageComposeDir = path.posix.dirname(path.posix.normalize(metadata.vm.composefile));

      await fs.promises.mkdir(composeDir, { recursive: true });
      await this.client.copyFile(
        this.image,
        imageComposeDir === '.' ? '/' : `${ imageComposeDir }/`,
        composeDir,
        { namespace: this.extensionNamespace });

      contents = await this.getComposeFileContents();
      // Always clobber the compose project name to avoid issues with length.
      contents.name = await this.getComposeName();
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
      for (const service of Object.values(contents.services)) {
        service.volumes ??= [];
        if (!service.volumes.find(v => typeof v !== 'string' && v?.target === '/run/guest-services')) {
          service.volumes.push({
            type:   'volume',
            source: 'r-d-x-guest-services',
            target: '/run/guest-services',
            volume: { nocopy: true },
          });
        }
      }
    }

    // Write out the modified compose file, either clobbering the original or
    // using the preferred name and shadowing the original.
    await fs.promises.writeFile(path.join(composeDir, 'compose.yaml'), JSON.stringify(contents));

    // Run `ctrctl compose up`
    console.debug(`Running ${ this.id } compose up for ${ contents.name }`);
    await this.client.composeUp(
      {
        composeDir,
        name:      await this.getComposeName(),
        namespace: this.extensionNamespace,
        env:       { DESKTOP_PLUGIN_IMAGE: this.image },
      },
    );
  }

  protected async markInstalled(workDir: string) {
    await fs.promises.writeFile(path.join(workDir, this.VERSION_FILE), this.version, 'utf-8');
  }

  async uninstall(): Promise<boolean> {
    const installedVersion = await this.getInstalledVersion();

    if (installedVersion !== undefined && installedVersion !== this.version) {
      // A _different_ version is installed; nothing to do here.
      // Note that we continue if no version is installed, in case there was a
      // partial install (so we can clean up leftover files).
      console.debug(`Extension ${ this.id }:${ installedVersion } is installed, skipping uninstall of ${ this.image }.`);

      return false;
    }

    try {
      const [scriptPath, ...scriptArgs] = this.getScriptArgs(await this.metadata, 'x-rd-uninstall') ?? [];

      if (scriptPath) {
        console.log(`Running ${ this.id } pre-uninstall script: ${ scriptPath } ${ scriptArgs.join(' ') }...`);
        await spawnFile(scriptPath, scriptArgs, { stdio: console, cwd: path.dirname(scriptPath) });
      }
    } catch (ex) {
      console.error(`Ignoring error running ${ this.id } pre-uninstall script: ${ ex }`);
    }

    try {
      await this.uninstallContainers();
    } catch (ex) {
      console.error(`Ignoring error stopping ${ this.id } containers on uninstall: ${ ex }`);
    }

    try {
      await fs.promises.rm(this.dir, { recursive: true, maxRetries: 3 });
    } catch (ex: any) {
      if ((ex as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw ex;
      }
    }

    mainEvents.emit('settings-write', { application: { extensions: { installed: { [this.id]: undefined } } } });

    return true;
  }

  protected async uninstallContainers() {
    const metadata = await this.metadata;

    if (!isVMTypeImage(metadata.vm) && !isVMTypeComposefile(metadata.vm)) {
      console.debug(`Extension ${ this.id } does not have containers to stop.`);

      return;
    }

    console.debug(`Running ${ this.id } compose down`);
    await this.client.composeDown({
      composeDir: path.join(this.dir, 'compose'),
      name:       await this.getComposeName(),
      namespace:  this.extensionNamespace,
      env:        { DESKTOP_PLUGIN_IMAGE: this.image },
    });
  }

  protected async getInstalledVersion(): Promise<string | undefined> {
    try {
      const filePath = path.join(this.dir, this.VERSION_FILE);
      const installed = await fs.promises.readFile(filePath, 'utf-8');

      return installed.trim();
    } catch (ex) {
      return undefined;
    }
  }

  async isInstalled(): Promise<boolean> {
    return this.version === await this.getInstalledVersion();
  }

  _composeFile: Promise<any> | undefined;
  get composeFile(): Promise<any> {
    this._composeFile ??= (async() => {
      // Because we wrote out `compose.yaml` in installContainers(), we
      // can assume that name.

      const filePath = path.join(this.dir, 'compose', 'compose.yaml');

      return yaml.parse(await fs.promises.readFile(filePath, 'utf-8'));
    })();

    return this._composeFile;
  }

  async getBackendPort() {
    const portInfo = await this.client.composePort({
      composeDir: path.join(this.dir, 'compose'),
      name:       await this.getComposeName(),
      namespace:  this.extensionNamespace,
      env:        { DESKTOP_PLUGIN_IMAGE: this.image },
      service:    'r-d-x-port-forwarding',
      port:       80,
      protocol:   'tcp',
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

    return this.client.composeExec({
      composeDir: path.join(this.dir, 'compose'),
      name:       await this.getComposeName(),
      namespace:  this.extensionNamespace,
      env:        { ...options.env, DESKTOP_PLUGIN_IMAGE: this.image },
      service,
      command:    options.command,
      ...options.cwd ? { workdir: options.cwd } : {},
    });
  }

  async extractFile(sourcePath: string, destinationPath: string): Promise<void> {
    await this.client.copyFile(
      this.image,
      sourcePath,
      destinationPath,
      { namespace: this.extensionNamespace });
  }

  async readFile(sourcePath: string): Promise<string> {
    return await this.client.readFile(this.image, sourcePath, { namespace: this.extensionNamespace });
  }

  async shutdown() {
    // Don't trigger downloading the extension if it hasn't been installed.
    const metadata = await this._metadata;

    if (!metadata) {
      return;
    }
    try {
      const [scriptPath, ...scriptArgs] = this.getScriptArgs(metadata, 'x-rd-shutdown') ?? [];

      if (scriptPath) {
        console.log(`Running ${ this.id } shutdown script: ${ scriptPath } ${ scriptArgs.join(' ') }...`);
        // No need to wait for the script to finish here.
        const stream = await console.fdStream;
        const process = spawn(scriptPath, scriptArgs, {
          detached: true, stdio: ['ignore', stream, stream], cwd: path.dirname(scriptPath), windowsHide: true,
        });

        process.unref();
      }
    } catch (ex) {
      console.error(`Ignoring error running ${ this.id } post-install script: ${ ex }`);
    }
  }
}
