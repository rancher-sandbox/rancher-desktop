import fs from 'fs';
import os from 'os';
import path from 'path';

import { jest } from '@jest/globals';

import { START_LINE, END_LINE } from '@pkg/integrations/manageLinesInFile';
jest.unstable_mockModule('@pkg/main/mainEvents', () => ({
  __esModule: true,
  default:    {
    emit:   jest.fn(),
    invoke: jest.fn(),
  },
}));

const describeUnix = os.platform() === 'win32' ? describe.skip : describe;
let testDir = '';
const savedEnv = process.env;

// Recursively gets paths of all files in a specific directory and
// its children. Files are returned as a flat array of absolute paths.
function readdirRecursive(dirPath: string): string[] {
  const dirents = fs.readdirSync(dirPath, { withFileTypes: true });
  const files = dirents.map((dirent) => {
    const absolutePath = path.resolve(dirPath, dirent.name);

    return dirent.isDirectory() ? readdirRecursive(absolutePath) : absolutePath;
  });

  return files.flat();
}

describeUnix('RcFilePathManager', () => {
  let pathManager: import('@pkg/integrations/pathManagerImpl').RcFilePathManager;

  beforeEach(async() => {
    const { RcFilePathManager } = await import('@pkg/integrations/pathManagerImpl');

    pathManager = new RcFilePathManager();
    testDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'rdtest-'));
    const spy = jest.spyOn(os, 'homedir');

    spy.mockReturnValue(testDir);
    process.env = { ...process.env, XDG_CONFIG_HOME: path.join(testDir, '.config') };
  });

  afterEach(async() => {
    process.env = savedEnv;
    const spy = jest.spyOn(os, 'homedir');

    spy.mockRestore();
    await fs.promises.rm(testDir, { recursive: true, force: true });
  });

  describe('enforce', () => {
    let bashProfilePath: string;
    let bashLoginPath: string;
    let profilePath: string;

    beforeEach(() => {
      bashProfilePath = path.join(testDir, '.bash_profile');
      bashLoginPath = path.join(testDir, '.bash_login');
      profilePath = path.join(testDir, '.profile');
    });

    it('should create zsh/csh/fish config files if the shells are installed', async() => {
      jest.spyOn(pathManager as any, 'isShellInstalled').mockResolvedValue(true);
      const rcNames = ['bashrc', 'zshrc', 'cshrc', 'tcshrc', 'config.fish'];

      await pathManager.enforce();
      let fileBlob = readdirRecursive(testDir).join(os.EOL);

      rcNames.forEach((rcName) => {
        expect(fileBlob).toMatch(rcName);
      });
      await pathManager.remove();
      fileBlob = readdirRecursive(testDir).join(os.EOL);
      rcNames.forEach((rcName) => {
        expect(fileBlob).not.toMatch(rcName);
      });
    });

    it('should not create zsh/csh/fish config files if the shells are not installed', async() => {
      jest.spyOn(pathManager as any, 'isShellInstalled').mockResolvedValue(false);
      await pathManager.enforce();
      const fileBlob = readdirRecursive(testDir).join(os.EOL);

      ['zshrc', 'cshrc', 'tcshrc', 'config.fish'].forEach((rcName) => {
        expect(fileBlob).not.toMatch(rcName);
      });
      expect(fileBlob).toMatch('bashrc');
    });

    it('should create .bash_profile if it, .profile or .bash_login does not exist', async() => {
      await pathManager.enforce();
      await expect(fs.promises.readFile(bashProfilePath, { encoding: 'utf-8' })).resolves.toMatch('.rd/bin');
      await expect(fs.promises.readFile(bashLoginPath, { encoding: 'utf-8' })).rejects.toThrow(/ENOENT/);
      await expect(fs.promises.readFile(profilePath, { encoding: 'utf-8' })).rejects.toThrow(/ENOENT/);
    });

    it('should modify .bash_profile if it, .bash_login and .profile exist', async() => {
      await fs.promises.writeFile(bashProfilePath, '');
      await fs.promises.writeFile(bashLoginPath, '');
      await fs.promises.writeFile(profilePath, '');

      await pathManager.enforce();

      await expect(fs.promises.readFile(bashProfilePath, { encoding: 'utf-8' })).resolves.toMatch('.rd/bin');
      await expect(fs.promises.readFile(bashLoginPath, { encoding: 'utf-8' })).resolves.not.toMatch('.rd/bin');
      await expect(fs.promises.readFile(profilePath, { encoding: 'utf-8' })).resolves.not.toMatch('.rd/bin');
    });

    it('should modify .bash_login if only it and/or .profile (and not .bash_profile) exist', async() => {
      await fs.promises.writeFile(bashLoginPath, '');
      await fs.promises.writeFile(profilePath, '');

      await pathManager.enforce();

      await expect(fs.promises.readFile(bashProfilePath, { encoding: 'utf-8' })).rejects.toThrow(/ENOENT/);
      await expect(fs.promises.readFile(bashLoginPath, { encoding: 'utf-8' })).resolves.toMatch('.rd/bin');
      await expect(fs.promises.readFile(profilePath, { encoding: 'utf-8' })).resolves.not.toMatch('.rd/bin');
    });

    it('should modify .profile if only it (and not .bash_profile or .bash_login) exists', async() => {
      await fs.promises.writeFile(profilePath, '');

      await pathManager.enforce();

      await expect(fs.promises.readFile(bashProfilePath, { encoding: 'utf-8' })).rejects.toThrow(/ENOENT/);
      await expect(fs.promises.readFile(bashLoginPath, { encoding: 'utf-8' })).rejects.toThrow(/ENOENT/);
      await expect(fs.promises.readFile(profilePath, { encoding: 'utf-8' })).resolves.toMatch('.rd/bin');
    });

    it('should remove lines from bash login shell files if they exist', async() => {
      const managedContent = 'managed content';
      const unmanagedContent = 'should not be touched';
      const content = [
        unmanagedContent,
        START_LINE,
        managedContent,
        END_LINE,
      ].join(os.EOL);

      await fs.promises.writeFile(bashProfilePath, content);
      await fs.promises.writeFile(bashLoginPath, content);
      await fs.promises.writeFile(profilePath, content);

      await pathManager.remove();

      await expect(fs.promises.readFile(bashProfilePath, { encoding: 'utf-8' })).resolves.not.toMatch(managedContent);
      await expect(fs.promises.readFile(bashProfilePath, { encoding: 'utf-8' })).resolves.toMatch(unmanagedContent);

      await expect(fs.promises.readFile(bashLoginPath, { encoding: 'utf-8' })).resolves.not.toMatch(managedContent);
      await expect(fs.promises.readFile(bashLoginPath, { encoding: 'utf-8' })).resolves.toMatch(unmanagedContent);

      await expect(fs.promises.readFile(profilePath, { encoding: 'utf-8' })).resolves.not.toMatch(managedContent);
      await expect(fs.promises.readFile(profilePath, { encoding: 'utf-8' })).resolves.toMatch(unmanagedContent);
    });
  });

  describe('isShellInstalled', () => {
    let binDir: string;
    let emptyDir: string;
    let shellsFile: string;

    beforeEach(async() => {
      binDir = path.join(testDir, 'bin');
      emptyDir = path.join(testDir, 'empty');
      shellsFile = path.join(testDir, 'shells');
      await fs.promises.mkdir(binDir);
      await fs.promises.mkdir(emptyDir);
      await fs.promises.writeFile(path.join(binDir, 'rdtest-shell'), '#!/bin/sh\n', { mode: 0o755 });
      (pathManager as any).shellsFilePath = path.join(testDir, 'nonexistent');
    });

    it('should find a shell on PATH', async() => {
      process.env.PATH = binDir;
      await expect((pathManager as any).isShellInstalled('rdtest-shell')).resolves.toBe(true);
    });

    it('should not find a shell that is not installed', async() => {
      process.env.PATH = emptyDir;
      await expect((pathManager as any).isShellInstalled('rdtest-shell')).resolves.toBe(false);
    });

    it('should search the fallback directories', async() => {
      process.env.PATH = '';
      await expect((pathManager as any).isShellInstalled('sh')).resolves.toBe(true);
    });

    it.each([
      '.nix-profile/bin',
      '.local/state/nix/profile/bin',
      '.linuxbrew/bin',
    ])('should search ~/%s', async(dir) => {
      const homeBin = path.join(testDir, dir);

      process.env.PATH = emptyDir;
      await fs.promises.mkdir(homeBin, { recursive: true });
      await fs.promises.writeFile(path.join(homeBin, 'rdtest-shell'), '#!/bin/sh\n', { mode: 0o755 });
      await expect((pathManager as any).isShellInstalled('rdtest-shell')).resolves.toBe(true);
    });

    it('should find an executable shell listed in the shells file', async() => {
      process.env.PATH = emptyDir;
      await fs.promises.writeFile(shellsFile, `# comment\n${ path.join(binDir, 'rdtest-shell') }\n`);
      (pathManager as any).shellsFilePath = shellsFile;
      await expect((pathManager as any).isShellInstalled('rdtest-shell')).resolves.toBe(true);
    });

    it('should ignore a missing shell listed in the shells file', async() => {
      process.env.PATH = emptyDir;
      await fs.promises.writeFile(shellsFile, `${ path.join(emptyDir, 'rdtest-shell') }\n`);
      (pathManager as any).shellsFilePath = shellsFile;
      await expect((pathManager as any).isShellInstalled('rdtest-shell')).resolves.toBe(false);
    });

    it('should ignore a directory listed in the shells file', async() => {
      const shellDir = path.join(testDir, 'dirs', 'rdtest-shell');

      process.env.PATH = emptyDir;
      await fs.promises.mkdir(shellDir, { recursive: true });
      await fs.promises.writeFile(shellsFile, `${ shellDir }\n`);
      (pathManager as any).shellsFilePath = shellsFile;
      await expect((pathManager as any).isShellInstalled('rdtest-shell')).resolves.toBe(false);
    });
  });
});
