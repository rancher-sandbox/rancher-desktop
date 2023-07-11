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

  for (const fd of ['stdout', 'stderr']) {
    const fdIndex = fd as 'stdout' | 'stderr';

    child[fdIndex]?.on('data', (chunk: string) => {
      const currentChunk = chunk.toString();
      const lastNLIndex = currentChunk.lastIndexOf('\n');

      if (lastNLIndex === -1) {
        currentLine[fdIndex] += currentChunk;
      } else {
        console.log(currentLine[fdIndex] + currentChunk.substring(0, lastNLIndex));
        currentLine[fdIndex] = currentChunk.substring(lastNLIndex + 1);
      }
    });
  }

  await new Promise<void>((resolve, reject) => {
    child.on('exit', (code, signal) => {
      if (currentLine.stdout) {
        console.log(currentLine.stdout);
      }
      if (currentLine.stderr) {
        console.log(currentLine.stderr);
      }
      if ((code === 0 && signal === null) || (code === null && signal === 'SIGTERM')) {
        return resolve();
      }
      reject(JSON.stringify({
        code, signal, message: `Command failed: ${ [command].concat(args ?? []).join(' ') }`,
      }));
    });
    child.on('error', reject);
  });
}
