import {
  spawn, SpawnOptions,
  SpawnOptionsWithStdioTuple, StdioPipe, StdioNull
} from 'child_process';
import stream from 'stream';

export {
  ChildProcess, SpawnOptions, exec, spawn
} from 'child_process';

/* eslint-disable no-redeclare */

interface SpawnOptionsWithStdio<
  Stdio extends 'pipe' | 'ignore' | 'inherit'
  > extends SpawnOptions {
  stdio: Stdio
}

interface SpawnOptionsEncoding {
  /**
   * The expected encoding of the executable.  If set, we will attempt to
   * convert the output to strings.
   */
  encoding?: { stdout?: BufferEncoding, stderr?: BufferEncoding } | BufferEncoding
}

/**
 * Wrapper around child_process.spawn() to promisify it.
 * @param command The executable to spawn.
 * @param args Any arguments to the executable.
 * @param options Options to child_process.spawn();
 */

export async function spawnFile(
  command: string,
): Promise<Record<string, never>>;
export async function spawnFile(
  command: string,
  options: SpawnOptionsWithStdio<'ignore' | 'inherit'> & SpawnOptionsEncoding,
): Promise<Record<string, never>>;
export async function spawnFile(
  command: string,
  options: SpawnOptionsWithStdio<'pipe'> & SpawnOptionsEncoding,
): Promise<{ stdout: string, stderr: string }>;
export async function spawnFile(
  command: string,
  options: SpawnOptionsWithStdioTuple<StdioNull | StdioPipe, StdioPipe, StdioPipe> & SpawnOptionsEncoding,
): Promise<{ stdout: string, stderr: string }>;
export async function spawnFile(
  command: string,
  options: SpawnOptionsWithStdioTuple<StdioNull | StdioPipe, StdioPipe, StdioNull> & SpawnOptionsEncoding,
): Promise<{ stdout: string }>;
export async function spawnFile(
  command: string,
  options: SpawnOptionsWithStdioTuple<StdioNull | StdioPipe, StdioNull, StdioPipe> & SpawnOptionsEncoding,
): Promise<{ stderr: string }>;
export async function spawnFile(
  command: string,
  options: SpawnOptionsWithStdioTuple<StdioNull | StdioPipe, StdioNull, StdioNull> & SpawnOptionsEncoding,
): Promise<Record<string, never>>;

export async function spawnFile(
  command: string,
  args: string[],
): Promise<Record<string, never>>;
export async function spawnFile(
  command: string,
  args: string[],
  options: SpawnOptionsWithStdio<'ignore' | 'inherit'> & SpawnOptionsEncoding,
): Promise<Record<string, never>>;
export async function spawnFile(
  command: string,
  args: string[],
  options: SpawnOptionsWithStdio<'pipe'> & SpawnOptionsEncoding,
): Promise<{ stdout: string, stderr: string }>;
export async function spawnFile(
  command: string,
  args: string[],
  options: SpawnOptionsWithStdioTuple<StdioNull | StdioPipe, StdioPipe, StdioPipe> & SpawnOptionsEncoding,
): Promise<{ stdout: string, stderr: string }>;
export async function spawnFile(
  command: string,
  args: string[],
  options: SpawnOptionsWithStdioTuple<StdioNull | StdioPipe, StdioPipe, StdioNull> & SpawnOptionsEncoding,
): Promise<{ stdout: string }>;
export async function spawnFile(
  command: string,
  args: string[],
  options: SpawnOptionsWithStdioTuple<StdioNull | StdioPipe, StdioNull, StdioPipe> & SpawnOptionsEncoding,
): Promise<{ stderr: string }>;
export async function spawnFile(
  command: string,
  args: string[],
  options: SpawnOptionsWithStdioTuple<StdioNull | StdioPipe, StdioNull, StdioNull> & SpawnOptionsEncoding,
): Promise<Record<string, never>>;

/* eslint-enable no-redeclare */
// eslint-disable-next-line no-redeclare
export async function spawnFile(
  command: string,
  args?: string[] | SpawnOptions & SpawnOptionsEncoding,
  options: SpawnOptions & SpawnOptionsEncoding = {}
): Promise<{ stdout?: string, stderr?: string }> {
  if (args && !Array.isArray(args)) {
    options = args;
    args = [];
  }

  let stdio = options.stdio;
  const encodings = [
    undefined, // stdin
    (typeof options.encoding === 'string') ? options.encoding : options.encoding?.stdout,
    (typeof options.encoding === 'string') ? options.encoding : options.encoding?.stderr,
  ];
  const stdStreams: [undefined, stream.Writable | undefined, stream.Writable | undefined] = [undefined, undefined, undefined];

  // If we're piping to a stream, and we need to override the encoding, then
  // we need to do setup here.
  if (Array.isArray(stdio)) {
    // Duplicate the array, in case the caller re-uses it somewhere.
    stdio = stdio.concat();
    if (stdio[1] instanceof stream.Writable && encodings[1]) {
      stdStreams[1] = stdio[1];
      stdio[1] = 'pipe';
    }
    if (stdio[2] instanceof stream.Writable && encodings[2]) {
      stdStreams[2] = stdio[2];
      stdio[2] = 'pipe';
    }
  } else if (typeof stdio === 'string') {
    stdio = [stdio, stdio, stdio];
  }

  // Spawn the child, overriding options.stdio.  This is necessary to support
  // transcoding the output.
  const child = spawn(command, args || [], { ...options, stdio });
  const resultMap: Record<number, 'stdout' | 'stderr'> = { 1: 'stdout', 2: 'stderr' };
  const result: { stdout?: string, stderr?: string } = {};

  if (Array.isArray(stdio)) {
    for (const i of [1, 2]) {
      if (stdio[i] === 'pipe') {
        const encoding = encodings[i];
        const childStream = child[resultMap[i]];

        if (!stdStreams[i]) {
          result[resultMap[i]] = '';
        }
        if (childStream) {
          if (encoding) {
            childStream.setEncoding(encoding);
          }
          childStream.on('data', (chunk) => {
            if (stdStreams[i]) {
              stdStreams[i]?.write(chunk);
            } else {
              result[resultMap[i]] += chunk;
            }
          });
        }
      }
    }
  }

  await new Promise<void>((resolve, reject) => {
    child.on('exit', (code, signal) => {
      if ((code === 0 && signal === null) || (code === null && signal === 'SIGTERM')) {
        return resolve();
      }
      if (code === null) {
        return reject(new Error(`${ command } exited with signal ${ signal }`));
      }
      reject(new Error(`${ command } exited with code ${ code }`));
    });
    child.on('error', reject);
  });

  return result;
}
