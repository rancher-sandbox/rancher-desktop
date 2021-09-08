import fs from 'fs';
import path from 'path';

import semver from 'semver';
import * as childProcess from '@/utils/childProcess';

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
    await fs.promises.access(referencePath, fs.constants.R_OK | fs.constants.X_OK);
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
  const paths: Array<string> = process.env.PATH?.split(path.delimiter) ?? [];

  let sawCurrentDir = false;

  for (const currentDir of paths) {
    if (currentDir === targetDir) {
      sawCurrentDir = true;
      continue;
    }
    const currentPath = path.join(currentDir, binaryName);

    try {
      await fs.promises.access(currentPath, fs.constants.X_OK);
    } catch (err) {
      continue;
    }

    // For kubectl, don't bother comparing versions, just existence is enough of a problem
    // if it occurs earlier in the path, because our kubectl is actually a symlink to kuberlr
    if (binaryName === 'kubectl') {
      if (!sawCurrentDir) {
        notes.push(`Existing instance of ${ binaryName } in ${ currentDir } hinders internal linking of kubectl to kuberlr.`);
      }
      continue;
    }
    const currentVersion = await getVersion(currentPath, binaryName);

    if (!currentVersion) {
      // If the tested executable gives unexpected output, ignore it -- it could be
      // due to any problem, such as copying /bin/ls into a directory above
      // /usr/local/bin/ and calling the copy `kim`. We can't catch all those problems.
      continue;
    }

    // complain about all earlier instances in the path if the version is different
    // complain about later instances only if they're newer
    if (!sawCurrentDir) {
      if (currentVersion.compare(proposedVersion) !== 0) {
        notes.push(`Existing instance of ${ binaryName } in ${ currentDir } has version ${ currentVersion }, shadows linked version ${ proposedVersion }.`);
      }
    } else if (currentVersion.compare(proposedVersion) >= 1) {
      notes.push(`Existing instance of ${ binaryName } in ${ currentDir } has version ${ currentVersion }, and will be shadowed by older linked version ${ proposedVersion }.`);
    }
  }

  return notes;
}

async function getVersion(fullPath: string, binaryName: string): Promise<semver.SemVer|null> {
  let stdout = '';

  try {
    stdout = (await childProcess.spawnFile(fullPath, [flags[binaryName]],
      { stdio: ['ignore', 'pipe', 'inherit'] })).stdout;
  } catch (err) {
    if (err.stdout) {
      stdout = err.stdout;
    } else {
      console.log(`Trying to determine version, can't get output from ${ fullPath } ${ [flags[binaryName]] }`);

      return null;
    }
  }
  const m = regexes[binaryName].exec(stdout);

  if (!m) {
    console.log(`Can't figure out version of ${ fullPath }, output: ${ stdout }`);

    return null;
  }

  return new semver.SemVer(m[1]);
}
