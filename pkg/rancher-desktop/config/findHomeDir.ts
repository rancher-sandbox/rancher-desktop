import fs from 'fs';
import path from 'path';

// Implement the same logic as in
// https://github.com/kubernetes/kubernetes/blob/ea07644/staging/ \
// src/k8s.io/client-go/util/homedir/homedir.go

function dropDuplicatesAndNils(a: Array<string | null | undefined>): string[] {
  return a.reduce((acceptedValues, currentValue) => {
    // Good-enough algorithm for reducing a small (3 items at this point) array into an ordered list
    // of unique non-empty strings.
    if (currentValue && !acceptedValues.includes(currentValue)) {
      return acceptedValues.concat(currentValue);
    } else {
      return acceptedValues;
    }
  }, [] as string[]);
}

export function findHomeDir(): string | null {
  if (process.platform !== 'win32') {
    if (process.env.HOME) {
      try {
        fs.accessSync(process.env.HOME);

        return process.env.HOME;
      } catch (ignore) { }
    }

    return null;
  }

  // $HOME is always favoured, but the k8s go-client prefers the other two env vars
  // differently depending on whether .kube/config exists or not.
  const homeDrivePath = process.env.HOMEDRIVE && process.env.HOMEPATH ? path.join(process.env.HOMEDRIVE, process.env.HOMEPATH) : null;
  const favourHomeDrivePathList: string[] =
    dropDuplicatesAndNils([process.env.HOME, homeDrivePath, process.env.USERPROFILE]);
  const favourUserProfileList: string[] =
    dropDuplicatesAndNils([process.env.HOME, process.env.USERPROFILE, homeDrivePath]);

  // 1. the first of %HOME%, %HOMEDRIVE%%HOMEPATH%, %USERPROFILE% containing a `.kube/config` file is returned.
  for (const dir of favourHomeDrivePathList) {
    try {
      fs.accessSync(path.join(dir, '.kube', 'config'));

      return dir;
    } catch {
      // No .kube/config found
    }
  }
  // 2. ...the first of %HOME%, %USERPROFILE%, %HOMEDRIVE%%HOMEPATH% that exists and is writeable is returned
  for (const dir of favourUserProfileList) {
    try {
      fs.accessSync(dir, fs.constants.W_OK);

      return dir;
    } catch {
      // No writable home-ish directory found
    }
  }
  // 3. ...the first of %HOME%, %USERPROFILE%, %HOMEDRIVE%%HOMEPATH% that exists is returned.
  for (const dir of favourUserProfileList) {
    try {
      fs.accessSync(dir);

      return dir;
    } catch {
      // No home-ish directory found at all
    }
  }

  // 4. if none of those locations exists, the first of
  // %HOME%, %USERPROFILE%, %HOMEDRIVE%%HOMEPATH% that is set is returned.
  return favourUserProfileList[0] ?? null;
}
