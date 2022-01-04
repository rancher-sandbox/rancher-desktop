import fs from 'fs';
import path from 'path';
import semver from 'semver';
import Logging from '@/utils/logging';

import * as childProcess from '@/utils/childProcess';
import resources from '@/resources';
import { isUnixError } from '@/typings/unix.interface';

const console = Logging.background;

const flags: Record<string, string> = {
  docker:  '-v',
  helm:    'version',
  kubectl: 'version',
};
const regexes: Record<string, RegExp> = {
  docker:  /version\s+(\S+?),/,
  // helm has to match both
  // current: version.BuildInfo{Version:"v3.5.3", ...
  // older:   Client: &version.Version{SemVer:"v2.16.12", ...
  helm:    /Version.*:.*?"v(.+?)"/,
  kubectl: /Client Version.*?GitVersion:"v(.+?)"/,
};
const referenceVersions: Record<string, semver.SemVer|null> = {
  docker:  null,
  helm:    null,
  kubectl: null,
};

/**
 * Stores the versions of utilities shipped with Rancher Desktop in the bundled `resource` directory.
 * Unlike versions in the user's PATH, those versions should only change if the application is
 * updated, in which case we'll be restarting with a new version cache.
 */
async function getCachedVersion(referencePath: string, binaryName: string): Promise<semver.SemVer|null> {
  if (referenceVersions[binaryName]) {
    return referenceVersions[binaryName];
  }
  const ver = await getVersion(referencePath, binaryName);

  if (!ver) {
    console.log(`Can't get version for ${ binaryName } in ${ referencePath }`);

    return null;
  }
  referenceVersions[binaryName] = ver;

  return ver;
}

export default async function pathConflict(targetDir: string, binaryName: string): Promise<Array<string>> {
  const referencePath = resources.executable(binaryName);
  // We don't ship nerdctl, just an unversioned stub; so hard-wire a truthy value.
  const isUnversioned = ['nerdctl'].includes(binaryName);

  try {
    await fs.promises.access(referencePath, fs.constants.R_OK | fs.constants.X_OK);
  } catch (err) {
    console.log(err);

    return [];
  }
  const proposedVersion = isUnversioned ? '1.2.3' : await getCachedVersion(referencePath, binaryName);

  if (!proposedVersion) {
    return [];
  }
  const notes: Array<string> = [];
  const paths: Array<string> = process.env.PATH?.split(path.delimiter) ?? [];
  let sawCurrentDir = false;

  targetDir = path.resolve(targetDir);
  for (const currentDir of paths) {
    // canonicalize path names to avoid trailing slashes and '/./' sequences
    // This is because users set the PATH environment variable, so
    // we need to accommodate any irregularities.
    // path.normalize doesn't remove a trailing slash, path.resolve does.
    if (path.resolve(currentDir) === targetDir) {
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
        notes.push(`Existing instance of ${ binaryName } in ${ currentDir } interferes with internal linking of kubectl to kuberlr.`);
      }
      continue;
    }
    if (isUnversioned) {
      if (!sawCurrentDir) {
        notes.push(`Existing instance of ${ binaryName } in ${ currentDir } shadows a linked instance.`);
      }
      continue;
    }
    const currentVersion = await getVersion(currentPath, binaryName);

    if (!currentVersion) {
      // If the tested executable gives unexpected output, ignore it -- it could be
      // due to any problem, such as copying /bin/ls into a directory above
      // /usr/local/bin/ and calling the copy `nerdctl`. We can't catch all those problems.
      continue;
    }

    // complain about all earlier instances in the path if the version is different
    // complain about later instances only if they're newer
    if (!sawCurrentDir) {
      if (!semver.eq(currentVersion, proposedVersion)) {
        notes.push(`Existing instance of ${ binaryName } in ${ currentDir } has version ${ currentVersion }, shadows linked version ${ proposedVersion }.`);
      }
    } else if (semver.gt(currentVersion, proposedVersion)) {
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
    if (isUnixError(err) && err.stdout) {
      stdout = err.stdout;
    } else {
      console.log(`Trying to determine version, can't get output from ${ fullPath } ${ [flags[binaryName]] }`, err);

      return null;
    }
  }
  const m = regexes[binaryName].exec(stdout);

  if (!m) {
    console.log(`Can't figure out version of ${ fullPath }, output: ${ stdout }`);

    return null;
  }

  return semver.parse(m[1]);
}
