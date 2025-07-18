/**
 * Code signing support for macOS.
 */

import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';

import { notarize } from '@electron/notarize';
import { build, Arch, Configuration, Platform } from 'app-builder-lib';
import { MacPackager } from 'app-builder-lib/out/macPackager';
import { AsyncTaskManager, log } from 'builder-util';
import { Target } from 'electron-builder';
import _ from 'lodash';
import plist from 'plist';
import yaml from 'yaml';

import { spawnFile } from '@pkg/utils/childProcess';

interface SigningConfig {
  entitlements: {
    default:   string[];
    overrides: {
      paths:        string[];
      entitlements: string[];
    }[];
  }
  constraints: {
    paths:        string[];
    self?:        Record<string, any>;
    parent?:      Record<string, any>;
    responsible?: Record<string, any>;
  }[]
  remove: string[];
}

export async function sign(workDir: string): Promise<string[]> {
  const certFingerprint = process.env.CSC_FINGERPRINT ?? '';
  const appleId = process.env.APPLEID;
  const appleIdPassword = process.env.AC_PASSWORD;
  const teamId = process.env.AC_TEAMID;

  if (certFingerprint.length < 1) {
    throw new Error(`CSC_FINGERPRINT environment variable not set; required to pick signing certificate.`);
  }

  const unpackedDir = path.join(workDir, 'unpacked');
  const appDir = path.join(unpackedDir, 'Rancher Desktop.app');
  const configPath = path.join(appDir, 'Contents/electron-builder.yml');
  const configText = await fs.promises.readFile(configPath, 'utf-8');
  const config: Configuration = yaml.parse(configText);
  const signingConfigPath = path.join(appDir, 'Contents/build/signing-config-mac.yaml');
  const signingConfigText = await fs.promises.readFile(signingConfigPath, 'utf-8');
  const signingConfig: SigningConfig = yaml.parse(signingConfigText, { merge: true });
  const plistsDir = path.join(workDir, 'plists');
  let wroteDefaultEntitlements = false;
  let constraintSkipped = false;

  log.info('Removing excess files...');
  await Promise.all(signingConfig.remove.map(async(relpath) => {
    await fs.promises.rm(path.join(appDir, relpath), { recursive: true });
  }));

  log.info('Signing application...');
  // We're not using @electron/osx-sign because it doesn't allow --launch-constraint-*
  await fs.promises.mkdir(plistsDir, { recursive: true });
  for await (const filePath of findFilesToSign(appDir)) {
    const relPath = path.relative(appDir, filePath);
    const fileHash = createHash('sha256').update(relPath, 'utf-8').digest('base64url');
    const args = ['--sign', certFingerprint, '--force', '--timestamp', '--options', 'runtime'];

    // Determine the entitlements
    const entitlementsOverride = signingConfig.entitlements.overrides.find(e => e.paths.includes(relPath));
    let entitlementName = 'default';
    let entitlements = signingConfig.entitlements.default;

    if (entitlementsOverride) {
      entitlementName = fileHash;
      entitlements = entitlementsOverride.entitlements;
    }
    const entitlementFile = path.join(plistsDir, `${ entitlementName }-entitlement.plist`);

    if (!wroteDefaultEntitlements || entitlementName !== 'default') {
      await fs.promises.writeFile(entitlementFile,
        plist.build(Object.fromEntries(entitlements.map(k => [k, true]))));
      wroteDefaultEntitlements ||= entitlementName === 'default';
    }
    args.push('--entitlements', entitlementFile);

    // Determine the launch constraints
    if (process.argv.includes('--skip-constraints')) {
      if (!constraintSkipped) {
        log.warn('Skipping --launch-constraint-...: --skip-constraints given.');
        constraintSkipped = true;
      }
    } else {
      const launchConstraints = signingConfig.constraints.find(c => c.paths.includes(relPath));
      const constraintTypes = ['self', 'parent', 'responsible'] as const;

      for (const constraintType of constraintTypes) {
        const constraint = launchConstraints?.[constraintType];

        if (constraint) {
          const constraintsFile = path.join(plistsDir, `${ fileHash }-constraint-${ constraintType }.plist`);

          await fs.promises.writeFile(constraintsFile, plist.build(evaluateConstraints(constraint)));
          args.push(`--launch-constraint-${ constraintType }`, constraintsFile);
        }
      }
    }

    await spawnFile('codesign', [...args, filePath], { stdio: 'inherit' });
  }

  log.info('Verifying application signature...');
  await spawnFile('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appDir], { stdio: 'inherit' });
  await spawnFile('codesign', ['--display', '--entitlements', '-', appDir], { stdio: 'inherit' });

  if (process.argv.includes('--skip-notarize')) {
    log.warn('Skipping notarization: --skip-notarize given.');
  } else if (appleId && appleIdPassword && teamId) {
    log.info('Notarizing application...');
    await notarize({
      appPath: appDir,
      appleId,
      appleIdPassword,
      teamId,
    });
  } else {
    const message = [
      'APPLEID, AC_PASSWORD, or AC_TEAMID environment variables not given, cannot notarize.',
      'To force skip notarization, please pass --skip-notarize to signing script.',
    ];

    throw new Error(message.join('\n'));
  }

  log.info('Building disk image and update archive...');
  const arch = process.env.M1 ? Arch.arm64 : Arch.x64;
  const productFileName = config.productName?.replace(/\s+/g, '.');
  const productArch = process.env.M1 ? 'aarch64' : 'x86_64';
  const artifactName = `${ productFileName }-\${version}-mac.${ productArch }.\${ext}`;
  const formats = ['dmg', 'zip'];

  // Build the dmg, explicitly _not_ using an identity; we just signed
  // everything as we wanted already.
  const results = await build({
    publish: 'never',
    targets: new Map([[Platform.MAC, new Map([[arch, formats]])]]),
    config:  _.merge<Configuration, Configuration>(config,
      {
        dmg: { writeUpdateInfo: false },
        mac: { artifactName, identity: null },
      }),
    prepackaged:             appDir,
    // Provide a custom packager factory so that we can override the packager
    // to skip generating blockmap files.  Generating the blockmap hangs on CI
    // for some reason.
    platformPackagerFactory: (info) => {
      return new CustomPackager(info);
    },
  });

  // The .dmg and the .zip have slightly different file names, so we need to
  // deal with them separately.

  const dmgFile = results.find(f => f.endsWith('.dmg'));
  const zipFile = results.find(f => f.endsWith('.zip'));

  if (!dmgFile) {
    throw new Error(`Could not find build disk image`);
  }
  if (!zipFile) {
    throw new Error(`Could not find build zip file`);
  }

  const dmgRenamedFile = dmgFile.replace('-mac.', '.');

  await fs.promises.rename(dmgFile, dmgRenamedFile);
  await Promise.all([dmgRenamedFile, zipFile].map((f) => {
    return spawnFile('codesign', ['--sign', certFingerprint, '--timestamp', f], { stdio: 'inherit' });
  }));

  return Object.values([dmgRenamedFile, zipFile]);
}

/**
 * Recursively walk the given directory and locate files to sign.
 */
async function * findFilesToSign(dir: string): AsyncIterable<string> {
  // When doing code signing, the children must be signed before their parents
  // (so that their signatures can be incorporated into the parent signature,
  // Merkle tree style).
  // Also, for "Foo.app", we can skip "Foo.app/Contents/MacOS/Foo" because the
  // act of signing the app bundle will sign the executable.
  for (const file of await fs.promises.readdir(dir, { withFileTypes: true })) {
    const fullPath = path.resolve(dir, file.name);

    if (file.isSymbolicLink()) {
      // Skip all symlinks; we sign the symlink target instead.
      continue;
    }
    if (file.isDirectory()) {
      yield * findFilesToSign(fullPath);
    }
    if (!file.isFile()) {
      continue; // We only sign regular files.
    }

    if (await isBundleExecutable(fullPath)) {
      // For bundles (apps and frameworks), we skip signing the executable
      // itself as it will be signed when signing the bundle.
      continue;
    }

    // For regular files, call `file` and check if it thinks it's Mach-O.
    // We previously read the file header, but that was unreliable.
    try {
      const { stdout } = await spawnFile('/usr/bin/file', ['--brief', fullPath], { stdio: 'pipe' });

      if (!stdout.startsWith('Mach-O ')) {
        continue;
      }
    } catch {
      log.info({ fullPath }, 'Failed to read file, assuming no need to sign.');
      continue;
    }

    // If the file is already signed, don't sign it again.
    try {
      await spawnFile('codesign', ['--verify', '--strict=all', '--test-requirement=anchor apple', fullPath]);
      log.info({ fullPath }, 'Skipping signing of already-signed directory');
    } catch {
      yield fullPath;
    }
  }

  if (dir.endsWith('.app') || dir.endsWith('.framework')) {
    // We need to sign app bundles, if they haven't been signed yet.
    try {
      await spawnFile('codesign', ['--verify', '--strict=all', '--test-requirement=anchor apple', dir]);
      log.info({ dir }, 'Skipping signing of already-signed directory');
    } catch {
      yield dir;
    }
  }
}

/**
 * Detect if the path of a plain file indicates that it's the bundle executable
 */
async function isBundleExecutable(fullPath: string): Promise<boolean> {
  const parts = fullPath.split(path.sep).reverse();

  if (parts.length >= 4) {
    // Anything.app/Contents/MacOS/executable - the check style here avoids spell checker.
    if (fullPath.endsWith(`.app/Contents/MacOS/${ parts[0] }`)) {
      // Check Anything.app/Contents/Info.plist for CFBundleExecutable
      const infoPlist = path.sep + path.join(...parts.slice(2).reverse(), 'Info.plist');

      try {
        const executableKey = 'CFBundleExecutable';
        const plistContents = await fs.promises.readFile(infoPlist, 'utf-8');
        const value = plist.parse(plistContents);

        if (typeof value !== 'object' || !(executableKey in value)) {
          return false;
        }

        return value[executableKey] === parts[0];
      } catch (ex) {
        log.info({ ex, infoPlist }, 'Failed to read Info.plist, assuming not the bundle executable.');

        return false;
      }
    }
  }

  if (parts.length >= 4) {
    // Foo.framework/Versions/A/Foo
    if (parts[3] === `${ parts[0] }.framework` && parts[2] === 'Versions') {
      return true;
    }
  }

  return false;
}

/**
 * Given a launch constraint, preprocess it to return values from the environment.
 */
function evaluateConstraints(constraint: Record<string, any>): Record<string, any> {
  return _.mapValues(constraint, (value) => {
    switch (typeof value) {
    case 'string':
      break;
    case 'object':
      if (Array.isArray(value)) {
        return value.map(v => evaluateConstraints(v));
      } else {
        return evaluateConstraints(value);
      }
    default:
      return value;
    }
    switch (value) {
    case '${AC_TEAMID}': // eslint-disable-line no-template-curly-in-string
      return process.env.AC_TEAMID || value;
    default:
      return value;
    }
  });
}

/**
 * CustomPackager overrides MacPackager to avoid building blockmap files
 */
class CustomPackager extends MacPackager {
  override pack(outDir: string, arch: Arch, targets: Target[], taskManager: AsyncTaskManager): Promise<any> {
    for (const target of targets) {
      if ('isWriteUpdateInfo' in target) {
        (target as any).isWriteUpdateInfo = false;
      }
    }

    return super.pack.call(this, outDir, arch, targets, taskManager);
  }
}
