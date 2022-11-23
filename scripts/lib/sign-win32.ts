/**
 * Code signing support for Windows.
 */

import fs from 'fs';
import path from 'path';

import { getSignVendorPath } from 'app-builder-lib/out/codeSign/windowsCodeSign';
import defaults from 'lodash/defaultsDeep';
import yaml from 'yaml';

import * as childProcess from '@pkg/utils/childProcess';

/**
 * Mandatory configuration for Windows.
 *
 * These values are hard-coded and will always be passed to electron-builder
 * when signing the installer.
 */
const REQUIRED_WINDOWS_CONFIG = {
  signingHashAlgorithms: ['sha256'],
  target:                'nsis',
};

/**
 * Default values for optional configuration for Windows.
 *
 * These are defaults that may be overridden (in electron-builder.yml).
 */
const DEFAULT_WINDOWS_CONFIG = {
  certificateSha1:        '', // set via CSC_FINGERPRINT
  rfc3161TimeStampServer: 'http://timestamp.digicert.com',
};

interface ElectronBuilderConfiguration {
  files?: Array<string>,
  win?: Partial<typeof DEFAULT_WINDOWS_CONFIG & typeof REQUIRED_WINDOWS_CONFIG>;
}

export async function sign(workDir: string) {
  const certFingerprint = process.env.CSC_FINGERPRINT ?? '';
  const certPassword = process.env.CSC_KEY_PASSWORD ?? '';

  if (certFingerprint.length < 1) {
    throw new Error(`CSC_FINGERPRINT environment variable not set; required to pick signing certificate.`);
  }

  // Sign individual files.  See https://github.com/electron-userland/electron-builder/issues/5968
  // We built this docker.exe, so we need to sign it

  const unpackedDir = path.join(workDir, 'unpacked');
  const resourcesRootDir = 'resources/resources/win32';
  const internalDir = path.join(resourcesRootDir, 'internal');
  const binDir = path.join(resourcesRootDir, 'bin');
  const whiteList: Record<string, Array<string>> = {
    '.':                ['Rancher Desktop.exe'],
    [resourcesRootDir]: ['wsl-helper.exe'],
    [internalDir]:      ['host-resolver.exe', 'privileged-service.exe', 'steve.exe', 'vtunnel.exe'],
    [binDir]:           ['docker.exe', 'docker-credential-none.exe', 'nerdctl.exe', 'rdctl.exe'],
  };

  const configText = await fs.promises.readFile(path.join(unpackedDir, 'electron-builder.yml'), 'utf-8');
  const config = yaml.parse(configText) as ElectronBuilderConfiguration;

  config.win ??= {};
  defaults(config.win, DEFAULT_WINDOWS_CONFIG);
  Object.assign(config.win, REQUIRED_WINDOWS_CONFIG);
  config.win.certificateSha1 = certFingerprint;

  const toolPath = path.join(await getSignVendorPath(), 'windows-10', process.arch, 'signtool.exe');
  const toolArgs = [
    'sign',
    '/debug',
    '/sha1', certFingerprint,
    '/fd', 'SHA256',
    '/td', 'SHA256',
    '/tr', config.win.rfc3161TimeStampServer as string,
    '/du', 'https://rancherdesktop.io',
  ];

  if (certPassword.length > 0) {
    toolArgs.push('/p', certPassword);
  }

  for (const subDir in whiteList) {
    for (const fileName of whiteList[subDir]) {
      const fullPath = path.join(unpackedDir, subDir, fileName);

      // Fail if a whitelisted file doesn't exist
      await fs.promises.access(fullPath);
      console.log(`Signing ${ fullPath }`);

      await childProcess.spawnFile(toolPath, [...toolArgs, fullPath], { stdio: 'inherit' });
    }
  }

  // For at least one release, we need to sign both NSIS (exe) and WiX (msi)
  // installers, so that older versions can find the new exe installer to
  // upgrade to.
  await buildWiX(workDir, unpackedDir, config);
  await buildNSIS(workDir, unpackedDir, config);
}

async function buildWiX(workDir: string, unpackedDir: string, config: ElectronBuilderConfiguration) {
  const buildInstaller = (await import('./installer-win32')).default;
  const installerPath = await buildInstaller(workDir, unpackedDir);

  if (!config.win?.certificateSha1) {
    throw new Error(`Assertion error: certificate fingerprint not set`);
  }

  const toolPath = path.join(await getSignVendorPath(), 'windows-10', process.arch, 'signtool.exe');
  const toolArgs = [
    'sign',
    '/debug',
    '/sha1', config.win.certificateSha1,
    '/fd', 'SHA256',
    '/td', 'SHA256',
    '/tr', config.win.rfc3161TimeStampServer as string,
    '/du', 'https://rancherdesktop.io',
    installerPath,
  ];

  await childProcess.spawnFile(toolPath, toolArgs, { stdio: 'inherit' });
}

async function buildNSIS(workDir: string, unpackedDir: string, config: ElectronBuilderConfiguration) {
  const internalDir = 'resources/resources/win32/internal';

  // Copy the signed privileged-service.exe for the installer build.
  const privilegedServiceFile = 'privileged-service.exe';
  const privilegedServiceFrom = path.join(unpackedDir, internalDir, privilegedServiceFile);
  const privilegedServiceTo = path.join(process.cwd(), 'resources/win32/internal', privilegedServiceFile);

  await fs.promises.copyFile(privilegedServiceFrom, privilegedServiceTo);

  // Generate an electron-builder.yml forcing the use of the cert.
  const newConfigPath = path.join(workDir, 'electron-builder.yml');

  await fs.promises.writeFile(newConfigPath, yaml.stringify(config), 'utf-8');

  // Rebuild the installer (automatically signing the installer & uninstaller).
  await childProcess.spawnFile(
    process.argv0,
    [
      process.argv[0],
      'node_modules/electron-builder/out/cli/cli.js',
      'build',
      '--prepackaged', unpackedDir,
      '--config', newConfigPath,
    ],
    {
      stdio: 'inherit',
      env:   { ...process.env, __COMPAT_LAYER: 'RunAsInvoker' },
    });
}
