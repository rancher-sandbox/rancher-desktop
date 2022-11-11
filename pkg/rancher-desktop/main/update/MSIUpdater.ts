import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

import { AllPublishOptions, newError } from 'builder-util-runtime';
import { NsisUpdater } from 'electron-updater';
import { InstallOptions } from 'electron-updater/out/BaseUpdater';
import { ElectronHttpExecutor } from 'electron-updater/out/electronHttpExecutor';
import { findFile } from 'electron-updater/out/providers/Provider';
import { verifySignature } from 'electron-updater/out/windowsExecutableCodeSignatureVerifier';
import { Lazy } from 'lazy-val';

import mainEvents from '@/main/mainEvents';
import paths from '@/utils/paths';

import type { AppAdapter } from 'electron-updater/out/AppAdapter';
import type { DownloadUpdateOptions } from 'electron-updater/out/AppUpdater';

/**
 * MsiUpdater implements updating for Rancher Desktop's MSI-based installer.
 */
// We extend from NsisUpdater because extending BaseUpdater appears to cause
// issues with AppImageUpdater (where it thinks BaseUpdater is undefined)?
export default class MsiUpdater extends NsisUpdater {
  // eslint-disable-next-line no-useless-constructor -- This is used to change visibility
  constructor(options?: AllPublishOptions | null, app?: AppAdapter) {
    super(options, app);
  }

  // This implements an abstract method in BaseUpdater.
  protected doDownloadUpdate(downloadUpdateOptions: DownloadUpdateOptions): Promise<string[]> {
    const { info, provider } = downloadUpdateOptions.updateInfoAndProvider;
    const fileInfo = findFile(provider.resolveFiles(info), 'msi');

    if (!fileInfo) {
      throw newError(`Could not find update information for MSI installer version ${ info.version }`,
        'ERR_UPDATER_INVALID_UPDATE_INFO');
    }

    return this.executeDownload({
      fileExtension: 'msi',
      fileInfo,
      downloadUpdateOptions,
      task:          async(destinationFile, downloadOptions, packageFile, removeTempDirIfAny) => {
        const httpExecutor: ElectronHttpExecutor = (this as any).httpExecutor;
        const mergedDownloadOptions = {
          ...downloadOptions,
          sha512: fileInfo.packageInfo?.sha512 ?? downloadOptions.sha512,
        };

        this._logger.debug?.(`Downloading update for ${ info.version } from ${ fileInfo.url } (sha512: ${ mergedDownloadOptions.sha512 })`);
        await httpExecutor.download(fileInfo.url, destinationFile, mergedDownloadOptions);
        const signatureError = await this.verifySignature_(destinationFile);

        if (signatureError) {
          await removeTempDirIfAny();
          throw newError(
            `New version ${ info.version } (${ fileInfo.url }) is not signed correctly: ${ signatureError }`,
            'ERR_UPDATER_INVALID_SIGNATURE');
        }
      },
    });
  }

  // Verify that the given file is signed by the expected entity (as configured
  // in electron-builder.yml).
  private async verifySignature_(destinationFile: string): Promise<string | null> {
    let publisherName: string | Array<string> | null;

    try {
      const configOnDisk: Lazy<any> = (this as any).configOnDisk;

      publisherName = (await configOnDisk.value).publisherName;
      if (!publisherName) {
        return null;
      }
    } catch (e: any) {
      if (e?.code === 'ENOENT') {
        return null; // No updates configured
      }
      throw e;
    }
    const publisherNames = Array.isArray(publisherName) ? publisherName : [publisherName];

    return await verifySignature(publisherNames, destinationFile, this._logger);
  }

  protected doInstall(options: InstallOptions): boolean {
    const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';
    const msiexec = path.join(systemRoot, 'system32', 'msiexec.exe');
    const args: string[] = [
      '/norestart',
      '/lv*', path.join(paths.logs, 'msiexec.log'),
      '/i', options.installerPath,
    ];

    if (options.isSilent) {
      args.push('/quiet');
    } else {
      args.push('/passive');
    }

    args.push(`MSIINSTALLPERUSER=${ options.isAdminRightsRequired || this.shouldElevate ? '0' : '1' }`);

    if (options.isForceRunAfter) {
      args.push('RDRUNAFTERINSTALL=1');
    }

    this._logger.debug?.(`Will invoke installer on restart with: msiexec ${ args.join(' ') }`);
    mainEvents.on('quit', () => {
      this._logger.debug?.(`Running msiexec ${ args.join(' ') }`);
      const proc = spawn(msiexec, args, {
        detached: true, stdio: 'ignore', windowsHide: true,
      });

      proc.on('error', (err: NodeJS.ErrnoException) => {
        this._logger.error(`Cannot run installer: error code: ${ err.code }`);
        this.dispatchError(err);
      });
      proc.on('exit', (code, signal) => {
        this._logger.debug?.(`msiexec exited with ${ code }/${ signal }`);
      });
      proc.unref();
    });

    return true;
  }

  /**
   * shouldElevate indicates whether we need elevation to install the update.
   */
  protected get shouldElevate(): boolean {
    // Unfortunately, we seem to be able to write to the application directory
    // even when installed elevated (possibly due to VirtualStore).  So we rely
    // on the existence of the privileged service executable to determine
    // whether we were installed elevated (since we drop the executed when
    // non-elevated to avoid also installing the privileged service).
    const checkPath = path.join(paths.resources, 'win32', 'internal', 'privileged-service.exe');

    this._logger.debug?.(`Checking if elevation is needed via ${ checkPath }...`);
    try {
      // Unfortunately, doInstall is synchronous, so we need to use the sync
      // version of access functions.
      fs.accessSync(checkPath, fs.constants.F_OK);
      this._logger.debug?.('Elevation is required.');

      return true;
    } catch (ex) {
      this._logger.debug?.(`Elevation is not required: ${ ex }`);

      return false;
    }
  }
}
