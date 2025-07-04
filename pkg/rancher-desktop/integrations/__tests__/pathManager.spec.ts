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

    it('should create rc files if they do not exist', async() => {
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
});
