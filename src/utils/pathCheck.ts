import fs from 'fs';
import path from 'path';
import childProcess from 'child_process';

import semver from 'semver';
import resources from '@/resources';

const fsPromises = fs.promises;

const flags: Record<string, string> = {
  helm:    'version',
  kim:     '-v',
  kubectl: 'version',
};
const regexes: Record<string, RegExp> = {
  // helm has to match both
  // current: version.BuildInfo{Version:"v3.5.3", ...
  // older:   Client: &version.Version{SemVer:"v2.16.12", ...
  helm:    /Version.*:.*?"v(.+?)"/,
  kim:     /version v(\S+)/,
  kubectl: /Client Version.*?GitVersion:"v(.+?)"/,
};

export default async function shadowInfo(sourceDir: string, targetDir: string, binaryName: string): Promise<Array<string>> {
  const notes: Array<string> = [];
  // Don't have access to Electron.app in unit tests, so can't use the resources module
  const referencePath = path.join(sourceDir, binaryName);

  try {
    await fsPromises.access(referencePath, fs.constants.R_OK | fs.constants.X_OK);
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.log(err);

      return notes;
    }
  }
  const proposedVersion = await getVersion(referencePath, binaryName);

  if (!proposedVersion) {
    return notes;
  }
  const paths: Array<string> = process.env.PATH?.split(path.delimiter) || [];

  let sawCurrentDir = false;

  for (const currentDir of paths) {
    if (currentDir === targetDir) {
      sawCurrentDir = true;
      continue;
    }
    const currentPath = path.join(currentDir, binaryName);

    try {
      await fsPromises.access(currentPath, fs.constants.R_OK | fs.constants.X_OK);
    } catch (err) {
      continue;
    }
    const currentVersion = await getVersion(currentPath, binaryName);

    // For kubectl, don't bother comparing versions, just existence is enough of a problem
    // if it occurs earlier in the path, because our kubectl is actually a symlink to kuberlr
    if (binaryName === 'kubectl') {
      if (!sawCurrentDir) {
        notes.push(`Existing instance of ${ binaryName } in ${ currentDir } has version ${ currentVersion }, shadows linked version ${ proposedVersion }`);
      }
      continue;
    }

    if (!currentVersion) {
      continue;
    }

    // complain about all earlier instances in the path if the version is different
    // complain about later instances only if they're newer
    if (!sawCurrentDir) {
      if (currentVersion.compare(proposedVersion) !== 0) {
        notes.push(`Existing instance of ${ binaryName } in ${ currentDir } has version ${ currentVersion }, shadows linked version ${ proposedVersion }`);
      }
    } else if (currentVersion.compare(proposedVersion) >= 1) {
      notes.push(`Existing instance of ${ binaryName } in ${ currentDir } has version ${ currentVersion }, and will be shadowed by older linked version ${ proposedVersion }`);
    }
  }

  return notes;
}

async function getVersion(fullPath: string, binaryName: string): Promise<semver.SemVer|null> {
  try {
    const stdout = (await childProcess.spawnSync(fullPath, [flags[binaryName]],
      { stdio: ['ignore', 'pipe', 'ignore'] })).stdout.toString();
    const m = regexes[binaryName].exec(stdout);

    if (!m) {
      console.log(`Can't figure out version of ${ fullPath }, output: ${ stdout }`);

      return null;
    }

    return new semver.SemVer(m[1]);
  } catch (err) {
    console.log(`Can't get output from ${ fullPath } ${ [flags[binaryName]] }`, err);

    return null;
  }
}
