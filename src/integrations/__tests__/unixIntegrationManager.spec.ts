import fs from 'fs';
import os from 'os';
import path from 'path';

import UnixIntegrationManager, { manageSymlink } from '@/integrations/unixIntegrationManager';

const INTEGRATION_DIR_NAME = 'integrationDir';
const TMPDIR_PREFIX = 'rdtest-';

const describeUnix = os.platform() === 'win32' ? describe.skip : describe;
const resourcesDir = path.join('resources', os.platform(), 'bin');
let testDir: string;

// Creates integration directory and docker CLI plugin directory with
// relevant symlinks in them. Useful for testing removal parts
// of UnixIntegrationManager.
async function createTestSymlinks(resourcesDirectory: string, integrationDirectory: string, dockerCliPluginDirectory: string): Promise<void> {
  await fs.promises.mkdir(integrationDirectory, { recursive: true, mode: 0o755 });
  await fs.promises.mkdir(dockerCliPluginDirectory, { recursive: true, mode: 0o755 });

  const kubectlSrcPath = path.join(resourcesDirectory, 'kubectl');
  const kubectlDstPath = path.join(integrationDirectory, 'kubectl');

  await fs.promises.symlink(kubectlSrcPath, kubectlDstPath);

  const composeSrcPath = path.join(resourcesDirectory, 'docker-compose');
  const composeDstPath = path.join(integrationDirectory, 'docker-compose');

  await fs.promises.symlink(composeSrcPath, composeDstPath);

  const composeCliDstPath = path.join(dockerCliPluginDirectory, 'docker-compose');

  await fs.promises.symlink(composeDstPath, composeCliDstPath);
}

beforeEach(async() => {
  testDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), TMPDIR_PREFIX));
});

afterEach(async() => {
  if (testDir.includes(TMPDIR_PREFIX)) {
    await fs.promises.rm(testDir, { recursive: true, force: true });
  }
});

describeUnix('UnixIntegrationManager', () => {
  let integrationDir: string;
  let dockerCliPluginDir: string;
  let integrationManager: UnixIntegrationManager;

  beforeEach(() => {
    integrationDir = path.join(testDir, INTEGRATION_DIR_NAME);
    dockerCliPluginDir = path.join(testDir, 'dockerCliPluginDir');
    integrationManager = new UnixIntegrationManager(
      resourcesDir, integrationDir, dockerCliPluginDir);
  });

  test('.enforce() should create dirs and symlinks properly', async() => {
    await integrationManager.enforce();
    for (const name of await fs.promises.readdir(resourcesDir)) {
      const integrationPath = path.join(integrationDir, name);
      const expectedValue = path.join(resourcesDir, name);

      await expect(fs.promises.readlink(integrationPath, 'utf8')).resolves.toEqual(expectedValue);
    }
    for (const name of await integrationManager.getDockerCliPluginNames()) {
      const pluginPath = path.join(dockerCliPluginDir, name);
      const expectedValue = path.join(integrationDir, name);

      await expect(fs.promises.readlink(pluginPath, 'utf8')).resolves.toEqual(expectedValue);
    }
  });

  test('.remove() should remove symlinks and dirs properly', async() => {
    await createTestSymlinks(resourcesDir, integrationDir, dockerCliPluginDir);

    await integrationManager.remove();
    await expect(fs.promises.readdir(integrationDir)).rejects.toThrow('ENOENT');
    await expect(fs.promises.readdir(dockerCliPluginDir)).resolves.toEqual([]);
  });

  test('.enforce() should not overwrite existing docker CLI plugins', async() => {
    // create existing plugin
    const existingPluginPath = path.join(dockerCliPluginDir, 'docker-compose');
    const existingPluginContents = 'meaningless contents';

    await fs.promises.mkdir(dockerCliPluginDir, { mode: 0o755 });
    await fs.promises.writeFile(existingPluginPath, existingPluginContents);

    await integrationManager.enforce();

    const newContents = await fs.promises.readFile(existingPluginPath, 'utf8');

    expect(newContents).toEqual(existingPluginContents);
  });

  test('.remove() should not remove existing docker CLI plugins', async() => {
    // create existing plugin
    const existingPluginPath = path.join(dockerCliPluginDir, 'docker-compose');
    const existingPluginContents = 'meaningless contents';

    await fs.promises.mkdir(dockerCliPluginDir, { mode: 0o755 });
    await fs.promises.writeFile(existingPluginPath, existingPluginContents);

    await integrationManager.remove();

    const newContents = await fs.promises.readFile(existingPluginPath, 'utf8');

    expect(newContents).toEqual(existingPluginContents);
  });

  test('.enforce() should be idempotent', async() => {
    await integrationManager.enforce();
    const intDirAfterFirstCall = await fs.promises.readdir(integrationDir);
    const dockerCliDirAfterFirstCall = await fs.promises.readdir(dockerCliPluginDir);

    await integrationManager.enforce();
    const intDirAfterSecondCall = await fs.promises.readdir(integrationDir);
    const dockerCliDirAfterSecondCall = await fs.promises.readdir(dockerCliPluginDir);

    expect(intDirAfterFirstCall).toEqual(intDirAfterSecondCall);
    expect(dockerCliDirAfterFirstCall).toEqual(dockerCliDirAfterSecondCall);
  });

  test('.remove() should be idempotent', async() => {
    await integrationManager.remove();
    const testDirAfterFirstCall = await fs.promises.readdir(testDir);

    expect(testDirAfterFirstCall).not.toContain(INTEGRATION_DIR_NAME);
    const dockerCliDirAfterFirstCall = await fs.promises.readdir(dockerCliPluginDir);

    expect(dockerCliDirAfterFirstCall).toEqual([]);

    await integrationManager.remove();
    const testDirAfterSecondCall = await fs.promises.readdir(testDir);

    expect(testDirAfterSecondCall).not.toContain(INTEGRATION_DIR_NAME);
    const dockerCliDirAfterSecondCall = await fs.promises.readdir(dockerCliPluginDir);

    expect(dockerCliDirAfterFirstCall).toEqual(dockerCliDirAfterSecondCall);
  });

  test('.removeSymlinksOnly() should remove symlinks but not integration directory', async() => {
    await createTestSymlinks(resourcesDir, integrationDir, dockerCliPluginDir);

    await integrationManager.removeSymlinksOnly();
    await expect(fs.promises.readdir(integrationDir)).resolves.toEqual([]);
    await expect(fs.promises.readdir(dockerCliPluginDir)).resolves.toEqual([]);
  });
});

describeUnix('manageSymlink', () => {
  const srcPath = path.join(resourcesDir, 'kubectl');
  let dstPath: string;

  beforeEach(() => {
    dstPath = path.join(testDir, 'kubectl');
  });

  test("should create the symlink if it doesn't exist", async() => {
    const dirContentsBefore = await fs.promises.readdir(testDir);

    expect(dirContentsBefore).toEqual([]);

    await manageSymlink(srcPath, dstPath, true);

    return fs.promises.readlink(dstPath);
  });

  test('should do nothing if file is correct symlink', async() => {
    await fs.promises.symlink(srcPath, dstPath);
    await manageSymlink(srcPath, dstPath, true);

    const newTarget = await fs.promises.readlink(dstPath);

    expect(newTarget).toEqual(srcPath);
  });

  test('should correct a symlink with an incorrect target', async() => {
    // create a file to target in the bad symlink
    const badSrcDir = path.join(testDir, 'resources', os.platform(), 'bin');
    const badSrcPath = path.join(badSrcDir, 'fakeKubectl');

    await fs.promises.mkdir(badSrcDir, { recursive: true, mode: 0o755 });
    await fs.promises.writeFile(badSrcPath, 'contents');
    await fs.promises.symlink(badSrcPath, dstPath);
    await manageSymlink(srcPath, dstPath, true);

    const newTarget = await fs.promises.readlink(dstPath);

    expect(newTarget).toEqual(srcPath);
  });

  test("should not touch the file if it isn't a symlink", async() => {
    // create the non-symlink dst file
    const contents = 'these contents should be kept';

    await fs.promises.writeFile(dstPath, contents);
    await manageSymlink(srcPath, dstPath, true);

    const newContents = await fs.promises.readFile(dstPath, 'utf8');

    expect(newContents).toEqual(contents);
  });

  test("should not touch the file if it isn't a symlink we own", async() => {
    const oldSrcPath = path.join(testDir, 'fakeKubectl');

    await fs.promises.writeFile(oldSrcPath, 'contents');
    await fs.promises.symlink(oldSrcPath, dstPath);
    await manageSymlink(srcPath, dstPath, true);

    const newTarget = await fs.promises.readlink(dstPath);

    expect(newTarget).toEqual(oldSrcPath);
  });

  test("should not touch the file if custom string doesn't match", async() => {
    const oldSrcPath = path.join(testDir, 'resources', os.platform(), 'bin', 'fakeKubectl');

    await fs.promises.symlink(oldSrcPath, dstPath);
    await manageSymlink(srcPath, dstPath, true, path.join('another', 'dir'));

    const newTarget = await fs.promises.readlink(dstPath);

    expect(newTarget).toEqual(oldSrcPath);
  });

  test('should change the file if the custom string matches', async() => {
    const customString = path.join('another', 'dir');
    const oldSrcDir = path.join(testDir, customString);
    const oldSrcPath = path.join(oldSrcDir, 'fakeKubectl');

    await fs.promises.mkdir(oldSrcDir, { recursive: true, mode: 0o755 });
    await fs.promises.symlink(oldSrcPath, dstPath);
    await manageSymlink(srcPath, dstPath, true, customString);

    const newTarget = await fs.promises.readlink(dstPath);

    expect(newTarget).toEqual(srcPath);
  });

  test('should delete the file if the target path matches', async() => {
    await fs.promises.symlink(srcPath, dstPath);
    await manageSymlink(srcPath, dstPath, false);

    return expect(fs.promises.readlink(dstPath)).rejects.toThrow('ENOENT');
  });

  test("shouldn't delete the file if the target path doesn't match", async() => {
    const oldSrcPath = path.join(testDir, 'fakeKubectl');

    await fs.promises.writeFile(oldSrcPath, 'contents');
    await fs.promises.symlink(oldSrcPath, dstPath);
    await manageSymlink(srcPath, dstPath, false);

    const newTarget = await fs.promises.readlink(dstPath);

    expect(newTarget).toEqual(oldSrcPath);
  });

  test("shouldn't delete the file if it isn't a symlink", async() => {
    const oldContents = "shouldn't be changed";

    await fs.promises.writeFile(dstPath, oldContents);
    await manageSymlink(srcPath, dstPath, false);

    const newContents = await fs.promises.readFile(dstPath, 'utf8');

    expect(newContents).toEqual(oldContents);
  });

  test('should do nothing if file is not present', async() => {
    const testDirContentsBefore = await fs.promises.readdir(testDir);

    expect(testDirContentsBefore).toEqual([]);
    await manageSymlink(srcPath, dstPath, false);
    const testDirContentsAfter = await fs.promises.readdir(testDir);

    return expect(testDirContentsAfter).toEqual([]);
  });

  test("should not remove the file if custom string doesn't match", async() => {
    const oldSrcPath = path.join(testDir, 'resources', os.platform(), 'bin', 'fakeKubectl');

    await fs.promises.symlink(oldSrcPath, dstPath);
    await manageSymlink(srcPath, dstPath, false, path.join('another', 'dir'));

    const newTarget = await fs.promises.readlink(dstPath);

    expect(newTarget).toEqual(oldSrcPath);
  });

  test('should remove the file if the custom string matches', async() => {
    const customString = path.join('another', 'dir');
    const oldSrcPath = path.join(testDir, customString, 'fakeKubectl');

    await fs.promises.symlink(oldSrcPath, dstPath);
    await manageSymlink(srcPath, dstPath, false, customString);

    return expect(fs.promises.readlink(dstPath)).rejects.toThrow('ENOENT');
  });
});
