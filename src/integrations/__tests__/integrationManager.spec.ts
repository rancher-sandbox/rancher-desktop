import fs from 'fs';
import os from 'os';
import path from 'path';
import IntegrationManager, { manageSymlink } from '@/integrations/integrationManager';

const resourcesDir = path.join('resources', os.platform(), 'bin');
let testDir: string;
let integrationDir: string;
let dockerCliPluginDir: string;

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

test('Ensure non-legacy symlinks and dirs are removed properly', async() => {
  const integrationManager = new IntegrationManager(resourcesDir, integrationDir, dockerCliPluginDir);
  await integrationManager.enforce();

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

test("manageSymlink should create the symlink if it doesn't exist", async() => {
  const srcPath = path.join(resourcesDir, 'kubectl');
  const dstPath = path.join(testDir, 'kubectl');
  await manageSymlink(srcPath, dstPath, true);
  return fs.promises.readlink(dstPath);
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
