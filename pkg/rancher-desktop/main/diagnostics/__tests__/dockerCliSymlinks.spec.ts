import fs from 'fs';
import os from 'os';
import path from 'path';

// The (mock) application directory.
let appDir = '';

// Mock Electron.app.getAppPath() to return appDir.
jest.mock('electron', () => {
  return {
    __esModule: true,
    default:    {
      app: {
        isPackaged: false,
        getAppPath: () => appDir,
      },
    },
  };
});

// Mock fs.promises.readdir() for the default export.
jest.spyOn(fs.promises, 'readdir').mockImplementation((dir, encoding) => {
  expect(dir).toEqual(path.join(appDir, 'resources', os.platform(), 'bin'));
  expect(encoding).toEqual('utf-8');

  return Promise.resolve([]);
});

// eslint-disable-next-line import/first -- Need to mock first.
import { CheckerDockerCLISymlink } from '../dockerCliSymlinks';

const { mkdtemp, rm } = jest.requireActual('fs/promises');
const describeUnix = process.platform === 'win32' ? describe.skip : describe;
const describeWin32 = process.platform === 'win32' ? describe : describe.skip;

describeUnix(CheckerDockerCLISymlink, () => {
  const executable = 'test-executable';
  const cliPluginsDir = path.join(os.homedir(), '.docker', 'cli-plugins');
  const rdBinDir = path.join(os.homedir(), '.rd', 'bin');
  const rdBinExecutable = path.join(rdBinDir, executable);
  let appDirExecutable = '';

  beforeAll(async() => {
    appDir = await mkdtemp(path.join(os.tmpdir(), 'rd-diag-'));
    await fs.promises.mkdir(path.join(appDir, 'resources'));
    appDirExecutable = path.join(appDir, 'resources', os.platform(), 'bin', executable);
  });
  afterAll(async() => {
    await rm(appDir, { recursive: true, force: true });
  });

  it('should be applicable', async() => {
    const subject = new CheckerDockerCLISymlink(executable);

    await expect(subject.applicable()).resolves.toBeTruthy();
  });

  it('should pass', async() => {
    const subject = new CheckerDockerCLISymlink(executable);

    jest.spyOn(subject, 'readlink').mockImplementationOnce((filepath, options) => {
      expect(options).toBeUndefined();
      expect(filepath).toEqual(path.join(cliPluginsDir, executable));

      return Promise.resolve(rdBinExecutable);
    }).mockImplementationOnce((filepath, options) => {
      expect(options).toBeUndefined();
      expect(filepath).toEqual(rdBinExecutable);

      return Promise.resolve(appDirExecutable);
    });
    jest.spyOn(subject, 'access').mockImplementation((filepath, mode) => {
      expect(filepath).toEqual(appDirExecutable);
      expect(mode).toEqual(fs.constants.X_OK);

      return Promise.resolve();
    });

    await expect(subject.check()).resolves.toEqual(expect.objectContaining({
      description: expect.stringMatching(new RegExp(`\`${ path.join('~/\\.docker/cli-plugins', executable) }\` is a symlink to \`${ appDirExecutable }\` through .*\.rd/bin/.*\.`)),
      passed:      true,
    }));
  });

  function wrongFirstLinkError(desc: string) {
    return new RegExp(`${ executable }\` should be a symlink to \`~/\\.rd/bin/${ executable }\`, ${ desc }\\.`);
  }

  function badFirstLinkError(desc: string) {
    return new RegExp(`${ executable }\` ${ desc }\\.\\s+It should be a symlink to \`~/\\.rd/bin/${ executable }\`\\.$`);
  }

  function badSecondLinkError(desc: string) {
    return new RegExp(`${ executable }\` should be a symlink to \`${ appDirExecutable }\`, ${ desc }\\.$`);
  }

  function problematicSecondLinkError(desc: string) {
    return new RegExp(`${ executable }\` is a symlink to \`${ appDirExecutable }\`, ${ desc }\\.`);
  }

  function intermediateFileNotSymlinkError(desc: string) {
    return new RegExp(
      `${ executable }\` ${ desc }\\. It should be a symlink to \`${ appDirExecutable }\`\\.`);
  }

  it('should catch missing link', async() => {
    const subject = new CheckerDockerCLISymlink(executable);

    jest.spyOn(subject, 'readlink').mockRejectedValue({ code: 'ENOENT' });
    jest.spyOn(subject, 'access');
    await expect(subject.check()).resolves.toEqual(expect.objectContaining({
      description: expect.stringMatching(badFirstLinkError('does not exist')),
      passed:      false,
    }));
    expect(jest.spyOn(subject, 'access')).not.toHaveBeenCalled();
  });

  it('should catch not a symlink', async() => {
    const subject = new CheckerDockerCLISymlink(executable);

    jest.spyOn(subject, 'readlink').mockRejectedValue({ code: 'EINVAL' });
    jest.spyOn(subject, 'access');
    await expect(subject.check()).resolves.toEqual(expect.objectContaining({
      description: expect.stringMatching(badFirstLinkError('is not a symlink')),
      passed:      false,
    }));
    expect(jest.spyOn(subject, 'access')).not.toHaveBeenCalled();
  });

  it('should catch generic errors', async() => {
    const subject = new CheckerDockerCLISymlink(executable);

    jest.spyOn(subject, 'readlink').mockRejectedValue({ code: 'EPONY' });
    jest.spyOn(subject, 'access');
    await expect(subject.check()).resolves.toEqual(expect.objectContaining({
      description: expect.stringMatching(badFirstLinkError('cannot be read')),
      passed:      false,
    }));
    expect(jest.spyOn(subject, 'access')).not.toHaveBeenCalled();
  });

  it('should catch incorrect link', async() => {
    const subject = new CheckerDockerCLISymlink(executable);

    jest.spyOn(subject, 'readlink')
      .mockResolvedValueOnce('/usr/bin/true')
      .mockRejectedValue({ code: 'EPONY' });
    jest.spyOn(subject, 'access');
    await expect(subject.check()).resolves.toEqual(expect.objectContaining({
      description: expect.stringMatching(wrongFirstLinkError('but points to `/usr/bin/true`')),
      passed:      false,
    }));
    expect(jest.spyOn(subject, 'access')).not.toHaveBeenCalled();
  });

  it('should catch incorrect second symlink', async() => {
    const subject = new CheckerDockerCLISymlink(executable);

    jest.spyOn(subject, 'readlink')
      .mockResolvedValueOnce(rdBinExecutable)
      .mockResolvedValueOnce('/usr/bin/true');
    jest.spyOn(subject, 'access');
    await expect(subject.check()).resolves.toEqual(expect.objectContaining({
      description: expect.stringMatching(badSecondLinkError('but points to `/usr/bin/true`')),
      passed:      false,
    }));
    expect(jest.spyOn(subject, 'access')).not.toHaveBeenCalled();
  });

  it('should catch non-existent second symlink', async() => {
    const subject = new CheckerDockerCLISymlink(executable);

    jest.spyOn(subject, 'readlink')
      .mockResolvedValueOnce(rdBinExecutable)
      .mockResolvedValueOnce(appDirExecutable);
    jest.spyOn(subject, 'access')
      .mockRejectedValue({ code: 'ENOENT' });
    await expect(subject.check()).resolves.toEqual(expect.objectContaining({
      description: expect.stringMatching(problematicSecondLinkError('which does not exist')),
      passed:      false,
    }));
    expect(jest.spyOn(subject, 'access')).toHaveBeenCalledTimes(1);
  });

  it('should catch looping second symlink', async() => {
    const subject = new CheckerDockerCLISymlink(executable);

    jest.spyOn(subject, 'readlink')
      .mockResolvedValueOnce(rdBinExecutable)
      .mockResolvedValueOnce(appDirExecutable);
    jest.spyOn(subject, 'access')
      .mockRejectedValue({ code: 'ELOOP' });
    await expect(subject.check()).resolves.toEqual(expect.objectContaining({
      description: expect.stringMatching(intermediateFileNotSymlinkError('is a symlink with a loop')),
      passed:      false,
    }));
    expect(jest.spyOn(subject, 'access')).toHaveBeenCalledTimes(1);
  });

  it('should catch inaccessible second symlink', async() => {
    const subject = new CheckerDockerCLISymlink(executable);

    jest.spyOn(subject, 'readlink')
      .mockResolvedValueOnce(rdBinExecutable)
      .mockResolvedValueOnce(appDirExecutable);
    jest.spyOn(subject, 'access')
      .mockRejectedValue({ code: 'EACCES' });
    await expect(subject.check()).resolves.toEqual(expect.objectContaining({
      description: expect.stringMatching(problematicSecondLinkError('which is not executable')),
      passed:      false,
    }));
    expect(jest.spyOn(subject, 'access')).toHaveBeenCalledTimes(1);
  });

  it('should catch error reading second symlink', async() => {
    const subject = new CheckerDockerCLISymlink(executable);

    jest.spyOn(subject, 'readlink')
      .mockResolvedValueOnce(rdBinExecutable)
      .mockResolvedValueOnce(appDirExecutable);
    jest.spyOn(subject, 'access')
      .mockRejectedValue({ code: 'EPONY' });
    await expect(subject.check()).resolves.toEqual(expect.objectContaining({
      description: expect.stringMatching(problematicSecondLinkError('but cannot be read \\(EPONY\\)')),
      passed:      false,
    }));
    expect(jest.spyOn(subject, 'access')).toHaveBeenCalledTimes(1);
  });
});

describeWin32(CheckerDockerCLISymlink, () => {
  test('should not apply', async() => {
    const subject = new CheckerDockerCLISymlink('blah');

    await expect(subject.applicable()).resolves.toBeFalsy();
  });
});
