import fs from 'fs';

import isEqual from 'lodash/isEqual.js';

export const START_LINE = '### MANAGED BY RANCHER DESKTOP START (DO NOT EDIT)';
export const END_LINE = '### MANAGED BY RANCHER DESKTOP END (DO NOT EDIT)';
const DEFAULT_FILE_MODE = 0o644;

/**
 * Inserts/removes fenced lines into/from a file. Idempotent.
 * @param path The path to the file to work on.
 * @param desiredManagedLines The lines to insert into the file.
 * @param desiredPresent Whether the lines should be present.
 */
export default async function manageLinesInFile(path: string, desiredManagedLines: string[], desiredPresent: boolean): Promise<void> {
  const copyFlags = fs.constants.COPYFILE_EXCL | fs.constants.COPYFILE_FICLONE;
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
    if (await fileHasExtendedAttributes(path)) {
      throw new Error(`Refusing to manage ${ path } which has extended attributes`);
    }

    const tempName = `${ path }.rd-temp`;

    await fs.promises.copyFile(path, tempName, copyFlags);

    try {
      const currentContents = await fs.promises.readFile(path, 'utf-8');
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

    await fs.promises.copyFile(path, backupPath, copyFlags);

    const currentContents = await fs.promises.readFile(path, 'utf-8');
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
      throw new Error(`Error writing to ${ path }: written contents are unexpected; see backup in ${ backupPath }`);
    }
    await fs.promises.unlink(backupPath);
  } else {
    // Target exists, and is neither a normal file nor a symbolic link.
    // Return with an error.
    throw new Error(`Refusing to manage ${ path } which is not a regular file`);
  }
}

/**
 * Check if the given file has any extended attributes.
 *
 * We do this check because we are not confident of being able to write the file
 * atomically (that is, either the old content or new content is visible) while
 * also preserving extended attributes.
 */
async function fileHasExtendedAttributes(filePath: string): Promise<boolean> {
  try {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- This only fails on Windows
    // @ts-ignore // fs-xattr is not available on Windows
    const { list } = await import('fs-xattr');

    return (await list(filePath)).length > 0;
  } catch {
    if (process.env.NODE_ENV === 'test' && process.env.RD_TEST !== 'e2e') {
      // When running unit tests, assume they do not have extended attributes.
      return false;
    }

    console.error(`Failed to import fs-xattr, cannot check for extended attributes on ${ filePath }; assuming it exists.`);

    return true;
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
