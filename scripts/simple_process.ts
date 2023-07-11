import { spawn, CommonSpawnOptions } from 'child_process';

/**
 * A wrapper around child_process.spawnFile that doesn't depend on any of the @pkg code
 * @param command
 * @param args - a string array of the arguments
 * @param options - options to pass to spawn()
 */
export async function simpleSpawn(
  command: string,
  args?: string[],
  options?: CommonSpawnOptions,
): Promise<void> {
  options ||= {};
  options.windowsHide ??= true;
  options.stdio ??= 'inherit';
  const child = spawn(command, args ?? [], options);
  const currentLine: Record<'stdout' | 'stderr', string> = { stdout: '', stderr: '' };
  let sawStderr = false;

  child.stdout?.on('data', (chunk: string) => {
    const currentChunk = chunk.toString();
    const lastNLIndex = currentChunk.lastIndexOf('\n');

    if (lastNLIndex === -1) {
      currentLine.stdout += currentChunk;
    } else {
      console.log(currentLine.stdout + currentChunk.substring(0, lastNLIndex));
      currentLine.stdout = currentChunk.substring(lastNLIndex + 1);
    }
  });
  child.stderr?.on('data', (chunk: string) => {
    const currentChunk = chunk.toString();
    const lastNLIndex = currentChunk.lastIndexOf('\n');

    sawStderr ||= currentChunk.length > 0;
    if (lastNLIndex === -1) {
      currentLine.stderr += currentChunk;
    } else {
      console.log(currentLine.stderr + currentChunk.substring(0, lastNLIndex));
      currentLine.stderr = currentChunk.substring(lastNLIndex + 1);
    }
  });

  await new Promise<void>((resolve, reject) => {
    child.on('exit', (code, signal) => {
      if (currentLine.stdout) {
        console.log(currentLine.stdout);
      }
      if (currentLine.stderr) {
        console.log(currentLine.stderr);
      }
      if (!sawStderr && ((code === 0 && signal === null) || (code === null && signal === 'SIGTERM'))) {
        return resolve();
      }
      reject(JSON.stringify({
        code, signal, message: `Command failed: ${ [command].concat(args ?? []).join(' ') }`,
      }));
    });
    child.on('error', reject);
  });
}
