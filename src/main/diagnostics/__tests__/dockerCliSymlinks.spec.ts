import fs from 'fs';
import os from 'os';
import path from 'path';

import paths from '@/utils/paths';

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
  expect(dir).toEqual(path.join(paths.resources, os.platform(), 'bin'));
  expect(encoding).toEqual('utf-8');

  return Promise.resolve([]);
});

// eslint-disable-next-line import/first, import/order -- Need to mock first.
import { CheckerDockerCLISymlink } from '../dockerCliSymlinks';

const { mkdtemp, rm } = jest.requireActual('fs/promises');

describe(CheckerDockerCLISymlink, () => {
  const executable = 'test-executable';
  const cliPluginsDir = path.join(os.homedir(), '.docker', 'cli-plugins');
  const rdBinDir = path.join(os.homedir(), '.rd', 'bin');
  const rdBinExecutable = path.join(rdBinDir, executable);
  let appDirExecutable = '';

  beforeAll(async() => {
    appDir = await mkdtemp(path.join(os.tmpdir(), 'rd-diag-'));
    appDirExecutable = path.join(appDir, executable);
  });
  afterAll(async() => {
    await rm(appDir, { recursive: true, force: true });
  });

  it('should pass', async() => {
    const subject = new CheckerDockerCLISymlink(executable);

    jest.spyOn(subject, 'readlink').mockImplementationOnce((filepath, options) => {
      expect(filepath).toEqual(path.join(cliPluginsDir, executable));
      expect(options).toBeUndefined();

      return Promise.resolve(rdBinExecutable);
    }).mockImplementationOnce((filepath, options) => {
      expect(filepath).toEqual(rdBinExecutable);
      expect(options).toBeUndefined();

      return Promise.resolve(appDirExecutable);
    }).mockImplementation((filepath, options) => {
      expect(filepath).toEqual(appDirExecutable);
      expect(options).toBeUndefined();

      return Promise.reject({ code: 'EINVAL' });
    });
    jest.spyOn(subject, 'access').mockImplementation((filepath, mode) => {
      expect(filepath).toEqual(appDirExecutable);
      expect(mode).toEqual(fs.constants.X_OK);

      return Promise.resolve();
    });

    await expect(subject.check()).resolves.toEqual(expect.objectContaining({
      description: expect.stringMatching(new RegExp(`${ executable } is a symlink to ~/\\.rd/${ executable }\\.$`)),
      passed:      true,
    }));
  });

  function matchError(desc: string) {
    return new RegExp(`${ executable } ${ desc }\\.\\s+It should be a symlink to ~/\\.rd/bin/${ executable }\\.$`);
  }

  it('should catch missing link', async() => {
    const subject = new CheckerDockerCLISymlink(executable);

    jest.spyOn(subject, 'readlink').mockRejectedValue({ code: 'ENOENT' });
    jest.spyOn(subject, 'access');
    await expect(subject.check()).resolves.toEqual(expect.objectContaining({
      description: expect.stringMatching(matchError('does not exist')),
      passed:      false,
    }));
    expect(jest.spyOn(subject, 'access')).not.toHaveBeenCalled();
  });

  it('should catch not a symlink', async() => {
    const subject = new CheckerDockerCLISymlink(executable);

    jest.spyOn(subject, 'readlink').mockRejectedValue({ code: 'EINVAL' });
    jest.spyOn(subject, 'access');
    await expect(subject.check()).resolves.toEqual(expect.objectContaining({
      description: expect.stringMatching(matchError('is not a symlink')),
      passed:      false,
    }));
    expect(jest.spyOn(subject, 'access')).not.toHaveBeenCalled();
  });

  it('should catch generic errors', async() => {
    const subject = new CheckerDockerCLISymlink(executable);

    jest.spyOn(subject, 'readlink').mockRejectedValue({ code: 'EPONY' });
    jest.spyOn(subject, 'access');
    await expect(subject.check()).resolves.toEqual(expect.objectContaining({
      description: expect.stringMatching(matchError('cannot be read')),
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
      description: expect.stringMatching(matchError('is a symlink to /usr/bin/true')),
      passed:      false,
    }));
    expect(jest.spyOn(subject, 'access')).not.toHaveBeenCalled();
  });

  it('should catch incorrect second symlink', async() => {
    const subject = new CheckerDockerCLISymlink(executable);

    jest.spyOn(subject, 'readlink')
      .mockResolvedValueOnce(rdBinExecutable)
      .mockResolvedValueOnce('/usr/bin/true')
      .mockRejectedValue({ code: 'EPONY' });
    jest.spyOn(subject, 'access');
    await expect(subject.check()).resolves.toEqual(expect.objectContaining({
      description: expect.stringMatching(matchError('is a symlink to /usr/bin/true, which is not from Rancher Desktop')),
      passed:      false,
    }));
    expect(jest.spyOn(subject, 'access')).not.toHaveBeenCalled();
  });

  it('should catch dangling second symlink', async() => {
    const subject = new CheckerDockerCLISymlink(executable);

    jest.spyOn(subject, 'readlink')
      .mockResolvedValueOnce(rdBinExecutable)
      .mockResolvedValueOnce(appDirExecutable)
      .mockRejectedValue({ code: 'EPONY' });
    jest.spyOn(subject, 'access')
      .mockRejectedValue({ code: 'ENOENT' });
    await expect(subject.check()).resolves.toEqual(expect.objectContaining({
      description: expect.stringMatching(matchError(`is a symlink to ${ appDirExecutable }, which does not exist`)),
      passed:      false,
    }));
    expect(jest.spyOn(subject, 'access')).toHaveBeenCalledTimes(1);
  });

  it('should catch looping second symlink', async() => {
    const subject = new CheckerDockerCLISymlink(executable);

    jest.spyOn(subject, 'readlink')
      .mockResolvedValueOnce(rdBinExecutable)
      .mockResolvedValueOnce(appDirExecutable)
      .mockRejectedValue({ code: 'EPONY' });
    jest.spyOn(subject, 'access')
      .mockRejectedValue({ code: 'ELOOP' });
    await expect(subject.check()).resolves.toEqual(expect.objectContaining({
      description: expect.stringMatching(matchError(`is a symlink with a loop`)),
      passed:      false,
    }));
    expect(jest.spyOn(subject, 'access')).toHaveBeenCalledTimes(1);
  });

  it('should catch inaccessible second symlink', async() => {
    const subject = new CheckerDockerCLISymlink(executable);

    jest.spyOn(subject, 'readlink')
      .mockResolvedValueOnce(rdBinExecutable)
      .mockResolvedValueOnce(appDirExecutable)
      .mockRejectedValue({ code: 'EPONY' });
    jest.spyOn(subject, 'access')
      .mockRejectedValue({ code: 'EACCES' });
    await expect(subject.check()).resolves.toEqual(expect.objectContaining({
      description: expect.stringMatching(matchError(`is a symlink to ${ appDirExecutable }, which is not executable`)),
      passed:      false,
    }));
    expect(jest.spyOn(subject, 'access')).toHaveBeenCalledTimes(1);
  });

  it('should catch error reading second symlink', async() => {
    const subject = new CheckerDockerCLISymlink(executable);

    jest.spyOn(subject, 'readlink')
      .mockResolvedValueOnce(rdBinExecutable)
      .mockResolvedValueOnce(appDirExecutable)
      .mockRejectedValue({ code: 'EPONY' });
    jest.spyOn(subject, 'access')
      .mockRejectedValue({ code: 'EPONY' });
    await expect(subject.check()).resolves.toEqual(expect.objectContaining({
      description: expect.stringMatching(matchError(`is a symlink to ${ appDirExecutable }, but we could not read it \\(EPONY\\)`)),
      passed:      false,
    }));
    expect(jest.spyOn(subject, 'access')).toHaveBeenCalledTimes(1);
  });
});
