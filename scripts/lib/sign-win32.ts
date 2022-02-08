/**
 * Code signing support for Windows.
 */

import fs from 'fs';
import path from 'path';

import { getSignVendorPath } from 'app-builder-lib/out/codeSign/windowsCodeSign';
import yaml from 'yaml';
import defaults from 'lodash/defaultsDeep';

import * as childProcess from '@/utils/childProcess';

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
    win?: Partial<typeof DEFAULT_WINDOWS_CONFIG & typeof REQUIRED_WINDOWS_CONFIG>;
}

export async function sign(workDir: string) {
  const certFingerprint = process.env.CSC_FINGERPRINT ?? '';
  const certPassword = process.env.CSC_KEY_PASSWORD ?? '';

  if (certFingerprint.length < 1) {
    throw new Error(`CSC_FINGERPRINT environment variable not set; required to pick signing certificate.`);
  }

  const configText = await fs.promises.readFile('electron-builder.yml', 'utf-8');
  const config = yaml.parse(configText) as ElectronBuilderConfiguration;

  config.win ??= {};
  defaults(config.win, DEFAULT_WINDOWS_CONFIG);

  // Sign individual files.  See https://github.com/electron-userland/electron-builder/issues/5968
  const unpackedDir = path.join(workDir, 'unpacked');

  for (const fileName of await fs.promises.readdir(unpackedDir)) {
    if (!fileName.endsWith('.exe')) {
      continue;
    }
    console.log(`Signing ${ fileName }`);

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
    toolArgs.push(path.join(unpackedDir, fileName));

    await childProcess.spawnFile(toolPath, toolArgs, { stdio: 'inherit' });
  }

  // Generate an electron-builder.yml forcing the use of the cert.
  const newConfigPath = path.join(workDir, 'electron-builder.yml');

  Object.assign(config.win, REQUIRED_WINDOWS_CONFIG);
  config.win.certificateSha1 = certFingerprint;
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
