/**
 * Windows Installer generation.
 *
 * While Electron-Builder has built-in MSI support, it's not quite as flexible
 * as we desired.  This runs WiX manually instead.
 */

/** @jsx Element.new */

import fs from 'fs';
import os from 'os';
import path from 'path';

import Mustache from 'mustache';

import generateFileList from './installer-win32-gen';

import { spawnFile } from '@/utils/childProcess';

/**
 * Given an unpacked application directory, return the application version.
 */
async function getAppVersion(appDir: string): Promise<string> {
  const exePath = path.join(appDir, 'Rancher Desktop.exe');
  const args = [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
    `(Get-ChildItem "${ exePath }").VersionInfo.ProductVersion`,
  ];
  const { stdout } = await spawnFile('powershell.exe', args, { stdio: ['ignore', 'pipe', 'inherit'] });

  return stdout.trim();
}

/**
 * Given an unpacked build, produce a MSI installer.
 * @param workDir Working directory; the application is extracted in the
 *        subdirectory "appDir" within this directory.
 */
export default async function buildInstaller(workDir: string, development = false) {
  const appDir = path.join(workDir, 'appDir');
  const appVersion = await getAppVersion(appDir);
  const compressionLevel = development ? 'mszip' : 'high';
  const fileList = await generateFileList(appDir);
  const template = await fs.promises.readFile(path.join(process.cwd(), 'build', 'wix', 'main.wxs'), 'utf-8');
  const output = Mustache.render(template, {
    appVersion, compressionLevel, fileList,
  });
  const wixDir = path.join(process.cwd(), 'resources', 'host', 'wix');

  console.log('Writing out WiX definition...');
  await fs.promises.writeFile(path.join(workDir, 'project.wxs'), output);
  await fs.promises.writeFile(path.join(process.cwd(), 'dist', 'project.wxs'), output);
  console.log('Compiling WiX...');
  const inputs = [
    path.join(workDir, 'project.wxs'),
    path.join(process.cwd(), 'build', 'wix', 'dialogs.wxs'),
  ];

  await Promise.all(inputs.map(input => spawnFile(
    path.join(wixDir, 'candle.exe'),
    [
      '-arch', 'x64',
      `-dappDir=${ path.join(workDir, 'appDir') }`,
      '-nologo',
      '-out', path.join(workDir, `${ path.basename(input, '.wxs') }.wixobj`),
      '-pedantic',
      '-wx',
      input,
    ],
    { stdio: 'inherit' })));
  console.log('Linking WiX...');
  await spawnFile(path.join(wixDir, 'light.exe'), [
    // Skip ICE 60, which checks for files with versions but no language (since
    // Windows Installer will always need to reinstall the file on a repair, in
    // case it's the wrong language).  This trips up our icon fonts, which we
    // do not install system-wide.
    // https://learn.microsoft.com/en-us/windows/win32/msi/ice60
    '-sice:ICE60',
    // Skip ICE 61, which is incompatible AllowSameVersionUpgrades and with emits:
    // error LGHT1076 : ICE61: This product should remove only older versions of itself.
    // https://learn.microsoft.com/en-us/windows/win32/msi/ice61
    '-sice:ICE61',
    `-dappDir=${ path.join(workDir, 'appDir') }`,
    '-ext', 'WixUIExtension',
    '-nologo',
    '-out', path.join(process.cwd(), 'dist', `Rancher Desktop Setup ${ appVersion }.msi`),
    '-pedantic',
    '-wx',
    '-cc', path.join(process.cwd(), 'dist', 'wix-cache'),
    '-reusecab',
    ...inputs.map(n => path.join(workDir, `${ path.basename(n, '.wxs') }.wixobj`)),
  ], { stdio: 'inherit' });
}

async function main() {
  const distDir = path.join(process.cwd(), 'dist');
  const zipName = (await fs.promises.readdir(distDir, 'utf-8')).find(f => f.endsWith('-win.zip'));

  if (!zipName) {
    throw new Error('Could not find zip file');
  }
  const workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'rd-wix-'), 'utf-8');
  const appDir = path.join(workDir, 'appDir');

  await fs.promises.mkdir(appDir);

  try {
    await spawnFile('unzip', ['-d', appDir, path.join(distDir, zipName)], { stdio: 'inherit' });
    await buildInstaller(workDir, true);
  } finally {
    await fs.promises.rm(workDir, { recursive: true });
  }
}

// hack
main().catch((e) => {
  console.error(e); process.exit(1);
});
