/**
 * This script builds the distributable packages. It assumes that we have _just_
 * built the JavaScript parts.
 */

'use strict';

import childProcess from 'child_process';
import fs from 'fs';
import * as path from 'path';

import { executeAppBuilder } from 'builder-util';
import _ from 'lodash';
import yaml from 'yaml';

import buildUtils from './lib/build-utils';
import buildInstaller, { buildCustomAction } from './lib/installer-win32';
import { simpleSpawn } from './simple_process';

import type { Configuration } from 'app-builder-lib';

/** Get the argument value (if any) for any of the given argument names */
function getArgValue(args: string[], ...argNames: string[]): string | undefined {
  for (const [i, arg] of args.entries()) {
    const lowerArg = arg.toLowerCase();

    for (const argName of argNames) {
      if (argName === lowerArg && i < args.length - 1) {
        return args[i + 1];
      }
      if (argName.startsWith('--')) {
        // long arg, "--variable=foo"
        if (lowerArg.startsWith(`${ argName }=`)) {
          return lowerArg.substring(argName.length + 1);
        }
      } else if (lowerArg.startsWith(argName)) {
        // short arg, "-vfoo"
        return lowerArg.substring(argName.length);
      }
    }
  }
}

class Builder {
  async replaceInFile(srcFile: string, pattern: string | RegExp, replacement: string, dstFile?: string) {
    dstFile = dstFile || srcFile;
    await fs.promises.stat(srcFile);
    const data = await fs.promises.readFile(srcFile, 'utf8');

    await fs.promises.writeFile(dstFile, data.replace(pattern, replacement));
  }

  async package() {
    console.log('Packaging...');

    // Build the electron builder configuration to include the version data
    const config: Configuration = yaml.parse(await fs.promises.readFile('electron-builder.yml', 'utf-8'));
    const configPath = path.join('dist', 'electron-builder.yaml');
    const fullBuildVersion = childProcess.execFileSync('git', ['describe', '--tags']).toString().trim();
    const finalBuildVersion = fullBuildVersion.replace(/^v/, '');
    const distDir = path.join(process.cwd(), 'dist');
    const args = process.argv.slice(2).filter(x => x !== '--serial');

    switch (process.platform) {
    case 'linux':
      await this.createLinuxResources(finalBuildVersion);
      break;
    case 'win32':
      await this.createWindowsResources(distDir);
      break;
    }

    _.set(config, 'extraMetadata.version', finalBuildVersion);
    await fs.promises.writeFile(configPath, yaml.stringify(config), 'utf-8');

    args.push('--config', configPath);
    await simpleSpawn('node', ['node_modules/electron-builder/out/cli/cli.js', ...args]);
  }

  async buildInstaller() {
    const appDir = path.join(buildUtils.distDir, 'win-unpacked');
    const args = process.argv.slice(2).filter(x => x !== '--serial');
    const targetList = getArgValue(args, '-w', '--win', '--windows');

    if (targetList !== 'zip') {
      // Only build installer if we're not asked not to.
      await buildInstaller(buildUtils.distDir, appDir);
    }
  }

  protected async createLinuxResources(finalBuildVersion: string) {
    const appData = 'packaging/linux/rancher-desktop.appdata.xml';
    const release = `<release version="${ finalBuildVersion }" date="${ new Date().toISOString() }"/>`;

    await this.replaceInFile(appData, /<release.*\/>/g, release, appData.replace('packaging', 'resources'));
  }

  protected async createWindowsResources(workDir: string) {
    // Create stub executable with the correct icon (for the installer)
    const imageFile = path.join(process.cwd(), 'resources', 'icons', 'logo-square-512.png');
    const iconArgs = ['icon', '--format', 'ico', '--out', workDir, '--input', imageFile];
    const iconResult = await this.executeAppBuilderAsJson(iconArgs);
    const iconFile = iconResult.icons[0].file;
    const executable = path.join(process.cwd(), 'resources', 'win32', 'internal', 'dummy.exe');
    const rceditArgs = [executable, '--set-icon', iconFile];

    await executeAppBuilder(['rcedit', '--args', JSON.stringify(rceditArgs)], undefined, undefined, 3);

    // Create the custom action for the installer
    await buildCustomAction();
  }

  protected async executeAppBuilderAsJson(...args: Parameters<typeof executeAppBuilder>) {
    const result = JSON.parse(await executeAppBuilder(...args));

    if (result.error) {
      throw new Error(result.error);
    }

    return result;
  }

  async run() {
    await this.package();
    if (process.platform === 'win32') {
      await this.buildInstaller();
    }
  }
}

(new Builder()).run().catch((e) => {
  console.error(e);
  process.exit(1);
});
