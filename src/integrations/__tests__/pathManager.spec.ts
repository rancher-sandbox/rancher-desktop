import fs from 'fs';
import os from 'os';
import path from 'path';
import { RcFilePathManager } from '@/integrations/pathManager';

let testDir = '';

async function readdirRecursive(dirPath: string): Promise<string[]> {
  const dirents = await fs.promises.readdir(dirPath, {withFileTypes: true});
  const files = await Promise.all(dirents.map((dirent) => {
    const absolutePath = path.resolve(dirPath, dirent.name);
    return dirent.isDirectory() ? readdirRecursive(absolutePath) : absolutePath;
  }));
  return files.flat();
}

beforeEach(async() => {
  testDir = await fs.promises.mkdtemp(path.join(os.tmpdir(),'rdtest-'));
  const spy = jest.spyOn(os, 'homedir');
  spy.mockReturnValue(testDir);
});

afterEach(async() => {
  const spy = jest.spyOn(os, 'homedir');
  spy.mockRestore();
  await fs.promises.rm(testDir, {recursive: true, force: true});
});

test("Ensure that RcFilePathManager enforce and remove work", async() => {
  let pathManager = new RcFilePathManager();
  await pathManager.enforce();
  let fileBlob = (await readdirRecursive(testDir)).join(os.EOL);
  const rcNames = ['bashrc', 'zshrc', 'cshrc', 'tcshrc', 'config.fish']
  rcNames.forEach((rcName) => {
    expect(fileBlob).toMatch(rcName);
  });
  await pathManager.remove();
  fileBlob = (await readdirRecursive(testDir)).join(os.EOL);
  rcNames.forEach((rcName) => {
    expect(fileBlob).not.toMatch(rcName);
  });
});
