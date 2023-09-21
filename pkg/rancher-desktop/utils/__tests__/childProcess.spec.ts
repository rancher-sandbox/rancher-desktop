import fs from 'fs';
import os from 'os';
import path from 'path';

import { Log } from '@pkg/utils/logging';

import * as childProcess from '../childProcess';

describe(childProcess.spawnFile, () => {
  function makeArg(fn: () => void) {
    return `--eval=(${ fn.toString() })();`;
  }

  test('returns output', async() => {
    const args = ['--version'];
    const result = await childProcess.spawnFile(process.execPath, args, { stdio: ['ignore', 'pipe', 'ignore'] });

    expect(result.stdout.trim()).toEqual(process.version);
    expect(result).not.toHaveProperty('stderr');
  });

  test('returns error', async() => {
    const args = [makeArg(() => console.error('hello'))];
    const result = await childProcess.spawnFile(process.execPath, args, { stdio: 'pipe' });

    expect(result.stdout).toEqual('');
    expect(result.stderr.trim()).toEqual('hello');
  });

  test('throws on failure', async() => {
    const args = [makeArg(() => {
      console.log('stdout');
      console.error('stderr');
      process.exit(1);
    })];
    const result = childProcess.spawnFile(process.execPath, args, { stdio: 'pipe' });

    await expect(result).rejects.toThrow('exited with code 1');
    await expect(result).rejects.toHaveProperty('stdout', 'stdout\n');
    await expect(result).rejects.toHaveProperty('stderr', 'stderr\n');
  });

  test('converts encodings on stdout', async() => {
    const args = [makeArg(() => console.log(Buffer.from('hello', 'utf16le').toString()))];
    const result = await childProcess.spawnFile(process.execPath, args, { stdio: 'pipe', encoding: 'utf16le' });

    expect(result.stdout.trim()).toEqual('hello');
  });

  test('converts encodings on stderr', async() => {
    const args = [makeArg(() => console.error(Buffer.from('hello', 'utf16le').toString()))];
    const result = await childProcess.spawnFile(process.execPath, args, { stdio: 'pipe', encoding: 'utf16le' });

    expect(result.stderr.trim()).toEqual('hello');
  });

  test('output to log', async() => {
    const workdir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'rd-test-childprocess-'));
    let log: Log | undefined;

    try {
      log = new Log('childprocess-test', workdir);
      const args = [makeArg(() => {
        console.log('stdout'); console.error('stderr');
      })];
      const result = await childProcess.spawnFile(process.execPath, args, { stdio: log });

      expect(result).not.toHaveProperty('stdout');
      expect(result).not.toHaveProperty('stderr');

      const output = await fs.promises.readFile(log.path, 'utf-8');

      expect(output).toContain('stdout');
      expect(output).toContain('stderr');
    } finally {
      log?.stream?.close();
      await fs.promises.rm(workdir, { recursive: true, maxRetries: 3 });
    }
  });

  test('prints stderr', async() => {
    const script = `
      console.log('Output on std!!out');
      console.error('Output on std!!err');
      process.exitCode = 42;
    `;

    try {
      await childProcess.spawnFile(process.execPath, ['-e', script], { stdio: 'pipe' });
    } catch (ex: any) {
      expect(ex).toBeInstanceOf(Error);
      // Check that the Error toString() is used
      expect(ex.toString()).toContain(`Error: ${ process.execPath }`);
      // Check that we have the exit code logged
      expect(ex.toString()).toContain('exited with code 42');
      // Check that we have stdout in the output
      expect(ex.toString()).toContain('std!!out');
      // CHeck that we have stderr in the output
      expect(ex.toString()).toContain('std!!err');
    }
  });
});
