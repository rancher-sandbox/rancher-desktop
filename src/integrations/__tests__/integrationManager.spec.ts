import fs from 'fs';
import os from 'os';
import path from 'path';
import IntegrationManager, { manageSymlink } from '@/integrations/integrationManager';

const resourcesDir = path.join('resources', os.platform(), 'bin');
let testDir: string;
let integrationDir: string;
let dockerCliPluginDir: string;

// Creates integration directory and docker CLI plugin directory with
// relevant symlinks in them. Useful for testing removal parts
// of IntegrationManager.
async function createTestSymlinks(resourcesDirectory: string, integrationDirectory: string, dockerCliPluginDirectory: string): Promise<void> {
  await fs.promises.mkdir(integrationDirectory, {recursive: true, mode: 0o755});
  await fs.promises.mkdir(dockerCliPluginDirectory, {recursive: true, mode: 0o755});

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
  testDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'rdtest-'));
  integrationDir = path.join(testDir, 'integrationDir');
  dockerCliPluginDir = path.join(testDir, 'dockerCliPluginDir');
});

afterEach(async() => {
  // It is best to be careful around rm's; we don't want to remove important things.
  if (testDir) {
    await fs.promises.rm(testDir, { recursive: true, force: true });
  }
});

test('Ensure symlinks and dirs are created properly', async() => {
  const integrationManager = new IntegrationManager(resourcesDir, integrationDir, dockerCliPluginDir);
  await integrationManager.enforce();
  expect(fs.promises.readdir(integrationDir)).resolves.not.toThrow();
  for (let name of await integrationManager.getIntegrationNames()) {
    const integrationPath = path.join(integrationDir, name);
    expect(fs.promises.readlink(integrationPath, 'utf8')).resolves.not.toThrow();
  }
  for (let name of await integrationManager.getDockerCliPluginNames()) {
    const pluginPath = path.join(dockerCliPluginDir, name);
    expect(fs.promises.readlink(pluginPath, 'utf8')).resolves.not.toThrow();
  }
});

test('Ensure symlinks and dirs are removed properly', async() => {
  await createTestSymlinks(resourcesDir, integrationDir, dockerCliPluginDir);
  const integrationManager = new IntegrationManager(resourcesDir, integrationDir, dockerCliPluginDir);
  await integrationManager.remove();
  expect(fs.promises.readdir(integrationDir)).rejects.toThrow();
  expect(fs.promises.readdir(dockerCliPluginDir)).resolves.toEqual([]);
});

test('Existing docker CLI plugins should not be overwritten upon .enforce()', async() => {
  // create existing plugin
  const existingPluginPath = path.join(dockerCliPluginDir, 'docker-compose');
  const existingPluginContents = 'meaningless contents';
  await fs.promises.mkdir(dockerCliPluginDir, {mode: 0o755});
  await fs.promises.writeFile(existingPluginPath, existingPluginContents);

  const integrationManager = new IntegrationManager(resourcesDir, integrationDir, dockerCliPluginDir);
  await integrationManager.enforce();

  const newContents = await fs.promises.readFile(existingPluginPath, 'utf8');
  expect(newContents).toEqual(existingPluginContents);
});

test('Existing docker CLI plugins should not be removed upon .remove()', async() => {
  // create existing plugin
  const existingPluginPath = path.join(dockerCliPluginDir, 'docker-compose');
  const existingPluginContents = 'meaningless contents';
  await fs.promises.mkdir(dockerCliPluginDir, {mode: 0o755});
  await fs.promises.writeFile(existingPluginPath, existingPluginContents);

  const integrationManager = new IntegrationManager(resourcesDir, integrationDir, dockerCliPluginDir);
  await integrationManager.remove();

  const newContents = await fs.promises.readFile(existingPluginPath, 'utf8');
  expect(newContents).toEqual(existingPluginContents);
});

test('.enforce() should be idempotent', async() => {
  const integrationManager = new IntegrationManager(resourcesDir, integrationDir, dockerCliPluginDir);
  await integrationManager.enforce();
  return integrationManager.enforce();
});

test('.remove() should be idempotent', async() => {
  const integrationManager = new IntegrationManager(resourcesDir, integrationDir, dockerCliPluginDir);
  await integrationManager.remove();
  return integrationManager.remove();
});

test('.appImageRemove should remove symlinks but not integration directory', async() => {
  await createTestSymlinks(resourcesDir, integrationDir, dockerCliPluginDir);
  const integrationManager = new IntegrationManager(resourcesDir, integrationDir, dockerCliPluginDir);
  await integrationManager.removeSymlinksOnly();
  await expect(fs.promises.readdir(integrationDir)).resolves.toEqual([]);
  await expect(fs.promises.readdir(dockerCliPluginDir)).resolves.toEqual([]);
});

test("manageSymlink should create the symlink if it doesn't exist", async() => {
  const srcPath = path.join(resourcesDir, 'kubectl');
  const dstPath = path.join(testDir, 'kubectl');
  await manageSymlink(srcPath, dstPath, true);
  return fs.promises.readlink(dstPath);
});

test("manageSymlink should do nothing if file is correct symlink", async() => {
  const srcPath = path.join(resourcesDir, 'kubectl');
  const dstPath = path.join(testDir, 'kubectl');
  await fs.promises.symlink(srcPath, dstPath);
  await manageSymlink(srcPath, dstPath, true);
  const newTarget = await fs.promises.readlink(dstPath);
  expect(newTarget).toEqual(srcPath);
});

test("manageSymlink should correct a symlink with an incorrect target", async() => {
  // create a file to target in the bad symlink
  const badSrcDir = path.join(testDir, 'resources', os.platform(), 'bin');
  await fs.promises.mkdir(badSrcDir, {recursive: true, mode: 0o755});
  const badSrcPath = path.join(badSrcDir, "fakeKubectl");
  await fs.promises.writeFile(badSrcPath, "contents")

  // create the bad symlink
  const dstPath = path.join(testDir, 'kubectl');
  await fs.promises.symlink(badSrcPath, dstPath);

  const srcPath = path.join(resourcesDir, 'kubectl');
  await manageSymlink(srcPath, dstPath, true);

  const newTarget = await fs.promises.readlink(dstPath);
  expect(newTarget).toEqual(srcPath);
});

test("manageSymlink should not touch the file if it isn't a symlink", async() => {
  // create the non-symlink dst file
  const contents = "these contents should be kept";
  const dstPath = path.join(testDir, 'kubectl');
  await fs.promises.writeFile(dstPath, contents)

  const srcPath = path.join(resourcesDir, 'kubectl');
  await manageSymlink(srcPath, dstPath, true);

  const newContents = await fs.promises.readFile(dstPath, 'utf8');
  expect(newContents).toEqual(contents);
});

test("manageSymlink should not touch the file if it isn't a symlink we own", async() => {
  const oldSrcPath = path.join(testDir, "fakeKubectl");
  await fs.promises.writeFile(oldSrcPath, "contents")

  const dstPath = path.join(testDir, 'kubectl');
  await fs.promises.symlink(oldSrcPath, dstPath);

  const srcPath = path.join(resourcesDir, 'kubectl');
  await manageSymlink(srcPath, dstPath, true);

  const newTarget = await fs.promises.readlink(dstPath);
  expect(newTarget).toEqual(oldSrcPath);
});

test("manageSymlink should not touch the file if custom string doesn't match", async() => {
  const oldSrcPath = path.join(testDir, 'resources', os.platform(), 'bin', 'fakeKubectl');
  const dstPath = path.join(testDir, 'kubectl');
  await fs.promises.symlink(oldSrcPath, dstPath);

  const srcPath = path.join(resourcesDir, 'kubectl');
  await manageSymlink(srcPath, dstPath, true, path.join('another', 'dir'));

  const newTarget = await fs.promises.readlink(dstPath);
  expect(newTarget).toEqual(oldSrcPath);
});

test("manageSymlink should change the file if the custom string matches", async() => {
  const customString = path.join('another', 'dir');
  const oldSrcDir = path.join(testDir, customString)
  await fs.promises.mkdir(oldSrcDir, {recursive: true, mode: 0o755});
  const oldSrcPath = path.join(oldSrcDir, 'fakeKubectl');
  const dstPath = path.join(testDir, 'kubectl');
  await fs.promises.symlink(oldSrcPath, dstPath);

  const srcPath = path.join(resourcesDir, 'kubectl');
  await manageSymlink(srcPath, dstPath, true, customString);

  const newTarget = await fs.promises.readlink(dstPath);
  expect(newTarget).toEqual(srcPath);
});

test("manageSymlink should delete the file if the target path matches", async() => {
  const dstPath = path.join(testDir, 'kubectl');
  const srcPath = path.join(resourcesDir, 'kubectl');
  await fs.promises.symlink(srcPath, dstPath);
  await manageSymlink(srcPath, dstPath, false);

  return expect(fs.promises.readlink(dstPath)).rejects.toThrow();
});

test("manageSymlink shouldn't delete the file if the target path doesn't match", async() => {
  const oldSrcPath = path.join(testDir, "fakeKubectl");
  await fs.promises.writeFile(oldSrcPath, "contents")

  const dstPath = path.join(testDir, 'kubectl');
  await fs.promises.symlink(oldSrcPath, dstPath);

  const srcPath = path.join(resourcesDir, 'kubectl');
  await manageSymlink(srcPath, dstPath, false);

  const newTarget = await fs.promises.readlink(dstPath);
  expect(newTarget).toEqual(oldSrcPath);
});

test("manageSymlink shouldn't delete the file if it isn't a symlink", async() => {
  const oldContents = "shouldn't be changed";
  const dstPath = path.join(testDir, 'kubectl');
  await fs.promises.writeFile(dstPath, oldContents);

  const srcPath = path.join(resourcesDir, 'kubectl');
  await manageSymlink(srcPath, dstPath, false);

  const newContents = await fs.promises.readFile(dstPath, 'utf8');
  expect(newContents).toEqual(oldContents);
});

test("manageSymlink should do nothing if file is not present", async() => {
  const dstPath = path.join(testDir, 'kubectl');
  const srcPath = path.join(resourcesDir, 'kubectl');
  return manageSymlink(srcPath, dstPath, false);
});

test("manageSymlink should not remove the file if custom string doesn't match", async() => {
  const oldSrcPath = path.join(testDir, 'resources', os.platform(), 'bin', 'fakeKubectl');
  const dstPath = path.join(testDir, 'kubectl');
  await fs.promises.symlink(oldSrcPath, dstPath);

  const srcPath = path.join(resourcesDir, 'kubectl');
  await manageSymlink(srcPath, dstPath, false, path.join('another', 'dir'));

  const newTarget = await fs.promises.readlink(dstPath);
  expect(newTarget).toEqual(oldSrcPath);
});

test("manageSymlink should remove the file if the custom string matches", async() => {
  const customString = path.join('another', 'dir');
  const oldSrcPath = path.join(testDir, customString, 'fakeKubectl');
  const dstPath = path.join(testDir, 'kubectl');
  await fs.promises.symlink(oldSrcPath, dstPath);

  const srcPath = path.join(resourcesDir, 'kubectl');
  await manageSymlink(srcPath, dstPath, false, customString);

  return expect(fs.promises.readlink(dstPath)).rejects.toThrow();
});
