import { execPath } from 'process';
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
    const args = [makeArg(() => process.exit(1))];
    const result = childProcess.spawnFile(process.execPath, args);

    await expect(result).rejects.toThrow('exited with code 1');
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
});
