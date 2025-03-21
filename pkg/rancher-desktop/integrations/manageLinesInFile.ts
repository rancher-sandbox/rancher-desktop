import fs from 'fs';

import isEqual from 'lodash/isEqual.js';

import Logging from '@pkg/utils/logging';

const console = Logging['path-management'];

export const START_LINE = '### MANAGED BY RANCHER DESKTOP START (DO NOT EDIT)';
export const END_LINE = '### MANAGED BY RANCHER DESKTOP END (DO NOT EDIT)';
const DEFAULT_FILE_MODE = 0o644;

/**
 * `newErrorWithPath` returns a dynamically constructed subclass of `Error` that
 * has a constructor that constructs a message using the `messageTemplate`
 * function, and also sets any inputs to the function as properties on the
 * resulting object.
 * @param messageTemplate A function used to generate an error message, based on
 *                        any arguments passed in as properties of an object.
 * @returns A subclass of Error.
 */
function newErrorWithPath<T extends Record<string, any>>(messageTemplate: (input: T) => string) {
  const result = class extends Error {
    constructor(input: T, options?: ErrorOptions) {
      super(messageTemplate(input), options);
      Object.assign(this, input);
    }
  };

  return result as unknown as new(...args: ConstructorParameters<typeof result>) => (InstanceType<typeof result> & T);
}

/**
 * `ErrorDeterminingExtendedAttributes` signifies that we failed to determine if
 * the given path contains extended attributes; to be safe, we are not managing
 * this file.
 */
export const ErrorDeterminingExtendedAttributes =
  newErrorWithPath(({ path }: {path: string}) => `Failed to determine if \`${ path }\` contains extended attributes`);
/**
 * `ErrorCopyingExtendedAttributes occurs if we failed to copy extended
 * attributes while managing a file.
 */
export const ErrorCopyingExtendedAttributes =
  newErrorWithPath(({ path }: {path: string}) => `Failed to copy extended attributes while managing \`${ path }\``);
/**
 * `ErrorNotRegularFile` signifies that we were unable to process a file because
 * it is not a regular file (e.g. a named pipe or a device).
 */
export const ErrorNotRegularFile =
  newErrorWithPath(({ path }: {path: string}) => `Refusing to manage \`${ path }\` which is neither a regular file nor a symbolic link`);
/**
 * `ErrorWritingFile` signifies that we attempted to process a file but writing
 * to it resulted in unexpected contents.
 */
export const ErrorWritingFile =
  newErrorWithPath(({ path, backupPath }: {path: string, backupPath: string}) => `Error writing to \`${ path }\`: written contents are unexpected; see backup in \`${ backupPath }\``);

/**
 * Inserts/removes fenced lines into/from a file. Idempotent.
 * @param path The path to the file to work on.
 * @param desiredManagedLines The lines to insert into the file.
 * @param desiredPresent Whether the lines should be present.
 * @throws If the file could not be managed; for example, if it has extended
 *         attributes, is not a regular file, or a backup exists.
 */
export default async function manageLinesInFile(path: string, desiredManagedLines: string[], desiredPresent: boolean): Promise<void> {
  const desired = getDesiredLines(desiredManagedLines, desiredPresent);
  let fileStats: fs.Stats;

  try {
    fileStats = await fs.promises.lstat(path);
  } catch (ex: any) {
    if (ex && 'code' in ex && ex.code === 'ENOENT') {
      // File does not exist.
      const content = computeTargetContents('', desired);

      if (content) {
        await fs.promises.writeFile(path, content, { mode: DEFAULT_FILE_MODE });
      }

      return;
    } else {
      throw ex;
    }
  }

  if (fileStats.isFile()) {
    const tempName = `${ path }.rd-temp`;

    await fs.promises.copyFile(path, tempName, fs.constants.COPYFILE_EXCL | fs.constants.COPYFILE_FICLONE);

    try {
      const currentContents = await fs.promises.readFile(tempName, 'utf-8');
      const targetContents = computeTargetContents(currentContents, desired);

      if (targetContents === undefined) {
        // No changes are needed
        return;
      }

      if (targetContents === '') {
        // The resulting file is empty; unlink it.
        await fs.promises.unlink(path);

        return;
      }

      await copyFileExtendedAttributes(path, tempName);
      await fs.promises.writeFile(tempName, targetContents, 'utf-8');
      await fs.promises.rename(tempName, path);
    } finally {
      try {
        await fs.promises.unlink(tempName);
      } catch {
        // Ignore errors unlinking the temporary file; if everything went well,
        // it no longer exists anyway.
      }
    }
  } else if (fileStats.isSymbolicLink()) {
    const backupPath = `${ path }.rd-backup~`;

    await fs.promises.copyFile(path, backupPath, fs.constants.COPYFILE_EXCL | fs.constants.COPYFILE_FICLONE);

    const currentContents = await fs.promises.readFile(backupPath, 'utf-8');
    const targetContents = computeTargetContents(currentContents, desired);

    if (targetContents === undefined) {
      // No changes are needed; just remove the backup file again.
      await fs.promises.unlink(backupPath);

      return;
    }
    // Always write the file, even if the result will be empty.
    await fs.promises.writeFile(path, targetContents, 'utf-8');

    const actualContents = await fs.promises.readFile(path, 'utf-8');

    if (!isEqual(targetContents, actualContents)) {
      throw new ErrorWritingFile({ path, backupPath });
    }
    await fs.promises.unlink(backupPath);
  } else {
    // Target exists, and is neither a normal file nor a symbolic link.
    // Return with an error.
    throw new ErrorNotRegularFile({ path });
  }
}

/**
 * Copies extended attributes from an existing file to a different file.  Both
 * files must already exist.
 */
async function copyFileExtendedAttributes(fromPath: string, toPath: string): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- This only fails on Windows
    // @ts-ignore // fs-xattr is not available on Windows
    const { listAttributes, getAttribute, setAttribute } = await import('fs-xattr');

    for (const attr of await listAttributes(fromPath)) {
      const value = await getAttribute(fromPath, attr);

      await setAttribute(toPath, attr, value);
    }
  } catch (cause) {
    if (process.env.NODE_ENV === 'test' && process.env.RD_TEST !== 'e2e') {
      // When running unit tests, assume they do not have extended attributes.
      return;
    }

    if (cause && typeof cause === 'object' && 'code' in cause && cause.code === 'MODULE_NOT_FOUND') {
      console.error(`Failed to import fs-xattr, cannot copy extended attributes from ${ fromPath }:`, cause);

      throw new ErrorDeterminingExtendedAttributes({ path: fromPath }, { cause });
    }
    throw new ErrorCopyingExtendedAttributes({ path: fromPath }, { cause });
  }
}

/**
 * Splits a file into three arrays containing the lines before the managed portion,
 * the lines in the managed portion and the lines after the managed portion.
 * @param lines An array where each element represents a line in a file.
 */
function splitLinesByDelimiters(lines: string[]): [string[], string[], string[]] {
  const startIndex = lines.indexOf(START_LINE);
  const endIndex = lines.indexOf(END_LINE);

  if (startIndex < 0 && endIndex < 0) {
    return [lines, [], []];
  } else if (startIndex < 0 || endIndex < 0) {
    throw new Error('exactly one of the delimiter lines is not present');
  } else if (startIndex >= endIndex) {
    throw new Error('the delimiter lines are in the wrong order');
  }

  const before = lines.slice(0, startIndex);
  const currentManagedLines = lines.slice(startIndex + 1, endIndex);
  const after = lines.slice(endIndex + 1);

  return [before, currentManagedLines, after];
}

/**
 * Calculate the desired content of the managed lines.
 * @param desiredManagedLines The lines to insert into the file.
 * @param desiredPresent Whether the lines should be present.
 * @returns The lines that should end up in the managed section of the final file.
 */
function getDesiredLines(desiredManagedLines: string[], desiredPresent: boolean): string[] {
  const desired = desiredPresent && desiredManagedLines.length > 0;

  return desired ? [START_LINE, ...desiredManagedLines, END_LINE] : [];
}

/**
 * Given the current contents of the file, determine what the final file
 * contents should be.
 * @param currentContents The current contents of the file.
 * @param desired The desired content of the managed lines.
 * @returns The final content; if no changes are needed, `undefined` is returned.
 *          There will never be any leading empty lines,
 *          and there will always be exactly one trailing empty line.
 */
function computeTargetContents(currentContents: string, desired: string[]): string | undefined {
  const [before, current, after] = splitLinesByDelimiters(currentContents.split('\n'));

  if (isEqual(current, desired)) {
    // No changes are needed
    return undefined;
  }

  const lines = [...before, ...desired, ...after];

  // Remove all leading empty lines.
  while (lines.length > 0 && lines[0] === '') {
    lines.shift();
  }
  // Remove all trailing empty lines.
  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  // Add one trailing empty line to the end.
  lines.push('');

  return lines.join('\n');
}
