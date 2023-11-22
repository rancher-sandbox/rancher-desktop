/**
 * Code signing support for Windows.
 */

import fs from 'fs';
import path from 'path';

import { getSignVendorPath } from 'app-builder-lib/out/codeSign/windowsCodeSign';
import defaults from 'lodash/defaultsDeep';
import yaml from 'yaml';

import { simpleSpawn } from 'scripts/simple_process';

/**
 * Mandatory configuration for Windows.
 *
 * These values are hard-coded and will always be passed to electron-builder
 * when signing the installer.
 */
const REQUIRED_WINDOWS_CONFIG = {
  signingHashAlgorithms: ['sha256'],
  target:                'zip',
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
  productName: string;
  files?: Array<string>;
  win?: Partial<typeof DEFAULT_WINDOWS_CONFIG & typeof REQUIRED_WINDOWS_CONFIG>;
}

async function getVersion() {
  const version = JSON.parse(await fs.promises.readFile('package.json', 'utf-8'))['version'];

  if (!version) {
    throw new Error("Can't find the version field in package.json");
  }

  return version;
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
  const configPath = path.join(unpackedDir, 'electron-builder.yml');
  const configText = await fs.promises.readFile(configPath, 'utf-8');
  const config = yaml.parse(configText) as ElectronBuilderConfiguration;
  const signingConfigPath = path.join(unpackedDir, 'build', 'signing-config-win.yaml');
  const signingConfigText = await fs.promises.readFile(signingConfigPath, 'utf-8');
  const signingConfig: Record<string, string[]> = yaml.parse(signingConfigText);
  const versionedAppName = `${ signingConfig.productName } ${ await getVersion() }`;

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
    '/d', versionedAppName,
  ];

  if (certPassword.length > 0) {
    toolArgs.push('/p', certPassword);
  }

  for await (const fullPath of findFilesToSign(unpackedDir, signingConfig)) {
    // Fail if a whitelisted file doesn't exist
    await fs.promises.access(fullPath);
    console.log(`Signing ${ fullPath }`);

    await simpleSpawn(toolPath, [...toolArgs, fullPath]);
  }

  await buildWiX(workDir, unpackedDir, config);
}

/**
 * Find all the files that should be signed.
 * @param unpackedDir The directory holding the unpacked zip file.
 * @param signingConfig The signing config from electron-builder.yaml
 */
async function *findFilesToSign(unpackedDir: string, signingConfig: Record<string, string[]>): AsyncIterable<string> {
  /** toSign is the set of files that we want to sign. */
  const toSign = new Set<string>();
  /** toSkip is the set of files we are explicitly skipping signing. */
  const toSkip = new Set<string>();
  /** unexpectedFiles is the set of files we found that are not known. */
  const unexpectedFiles = new Set<string>();

  for (const [dir, files] of Object.entries(signingConfig)) {
    for (const file of files) {
      if (file.startsWith('!')) {
        toSkip.add(path.normalize(path.join(unpackedDir, dir, file.slice(1))));
      } else {
        toSign.add(path.normalize(path.join(unpackedDir, dir, file)));
      }
    }
  }

  for (const child of await fs.promises.readdir(unpackedDir, { recursive: true, withFileTypes: true })) {
    const childPath = path.normalize(path.join(child.path, child.name));

    if (!/\.exe$/i.test(childPath)) {
      continue;
    }
    if (toSign.has(childPath)) {
      yield childPath;
    } else if (!toSkip.has(childPath)) {
      unexpectedFiles.add(path.relative(unpackedDir, childPath));
    }
  }

  if (unexpectedFiles.size > 0) {
    const message = [
      'Found unknown executable files:',
      ...Array.from(unexpectedFiles).map(f => ` - ${ f }`).sort(),
      'Please edit build/signing-config-win.yaml to add those files.',
    ];

    throw new Error(message.join('\n'));
  }
}

async function buildWiX(workDir: string, unpackedDir: string, config: ElectronBuilderConfiguration) {
  const buildInstaller = (await import('./installer-win32')).default;
  const installerPath = await buildInstaller(workDir, unpackedDir);
  const versionedAppName = `${ config.productName } ${ await getVersion() }`;

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
    '/d', versionedAppName,
    installerPath,
  ];

  await simpleSpawn(toolPath, toolArgs);
}
