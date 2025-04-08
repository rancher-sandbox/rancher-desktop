import { spawn } from 'child_process';
import path from 'path';

import { AllPublishOptions, newError } from 'builder-util-runtime';
import { NsisUpdater } from 'electron-updater';
import { InstallOptions } from 'electron-updater/out/BaseUpdater';
import { ElectronHttpExecutor } from 'electron-updater/out/electronHttpExecutor';
import { findFile } from 'electron-updater/out/providers/Provider';
import { verifySignature } from 'electron-updater/out/windowsExecutableCodeSignatureVerifier';
import { Lazy } from 'lazy-val';
import * as reg from 'native-reg';

import mainEvents from '@pkg/main/mainEvents';
import paths from '@pkg/utils/paths';

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
    const installerPath = this.installerPath;

    if (!installerPath) {
      this._logger.error('doInstall() called without a installer path');
      this.dispatchError(new Error("No valid update available, can't quit and install"));

      return false;
    }

    const args: string[] = [
      '/norestart',
      '/lv*', path.join(paths.logs, 'msiexec.log'),
      '/i', installerPath,
    ];
    const elevate = options.isAdminRightsRequired || this.shouldElevate;

    if (options.isSilent && !elevate) {
      args.push('/quiet');
    } else {
      args.push('/passive');
    }

    args.push(`MSIINSTALLPERUSER=${ elevate ? '0' : '1' }`);

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
    let key: any = null;
    let isAdmin = false;

    try {
      key = reg.openKey(reg.HKLM, 'SOFTWARE', reg.Access.READ);

      if (key) {
        const parsedValue = reg.getValue(key, 'SUSE\\RancherDesktop', 'AdminInstall');

        isAdmin = parsedValue !== null;

        return isAdmin;
      } else {
        this._logger.debug?.(`Failed to open registry key: HKEY_LOCAL_MACHINE\SOFTWARE: ${ key }/${ isAdmin }`);
      }
    } catch (error) {
      this._logger.error(`Error accessing registry: ${ error }`);
    } finally {
      reg.closeKey(key);
    }

    return isAdmin;
  }
}
