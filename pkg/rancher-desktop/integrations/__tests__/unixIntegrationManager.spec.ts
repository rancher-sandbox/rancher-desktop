import fs from 'fs';
import os from 'os';
import path from 'path';

import UnixIntegrationManager, { ensureSymlink } from '@pkg/integrations/unixIntegrationManager';

const INTEGRATION_DIR_NAME = 'integrationDir';
const TMPDIR_PREFIX = 'rdtest-';

const describeUnix = os.platform() === 'win32' ? describe.skip : describe;
const binDir = path.join('resources', os.platform(), 'bin');
const dockerCLIPluginSource = path.join('resources', os.platform(), 'docker-cli-plugins');
let testDir: string;

// Creates integration directory and docker CLI plugin directory with
// relevant symlinks in them. Useful for testing removal parts
// of UnixIntegrationManager.
async function createTestSymlinks(integrationDirectory: string, dockerCLIPluginDest: string): Promise<void> {
  await fs.promises.mkdir(integrationDirectory, { recursive: true, mode: 0o755 });
  await fs.promises.mkdir(dockerCLIPluginDest, { recursive: true, mode: 0o755 });

  const kubectlSrcPath = path.join(binDir, 'kubectl');
  const kubectlDstPath = path.join(integrationDirectory, 'kubectl');

  await fs.promises.symlink(kubectlSrcPath, kubectlDstPath);

  const composeSrcPath = path.join(dockerCLIPluginSource, 'docker-compose');
  const composeDstPath = path.join(dockerCLIPluginDest, 'docker-compose');

  await fs.promises.symlink(composeSrcPath, composeDstPath);
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
  let dockerCLIPluginDest: string;
  let integrationManager: UnixIntegrationManager;

  beforeEach(() => {
    integrationDir = path.join(testDir, INTEGRATION_DIR_NAME);
    dockerCLIPluginDest = path.join(testDir, 'dockerCliPluginDir');
    integrationManager = new UnixIntegrationManager({
      binDir, integrationDir, dockerCLIPluginSource, dockerCLIPluginDest,
    });
  });

  describe('enforce', () => {
    test('should create dirs and symlinks properly', async() => {
      await integrationManager.enforce();
      for (const name of await fs.promises.readdir(binDir)) {
        const integrationPath = path.join(integrationDir, name);
        const expectedValue = path.join(binDir, name);

        await expect(fs.promises.readlink(integrationPath, 'utf8')).resolves.toEqual(expectedValue);
      }
      for (const name of await fs.promises.readdir(dockerCLIPluginSource)) {
        const binPath = path.join(integrationDir, name);
        const pluginPath = path.join(dockerCLIPluginDest, name);
        const expectedValue = path.join(dockerCLIPluginSource, name);

        await expect(fs.promises.readlink(pluginPath, 'utf8')).resolves.toEqual(binPath);
        await expect(fs.promises.readlink(binPath, 'utf8')).resolves.toEqual(expectedValue);
      }
    });

    test('should not overwrite an existing docker CLI plugin that is a regular file', async() => {
      // create existing plugin
      const existingPluginPath = path.join(dockerCLIPluginDest, 'docker-compose');
      const existingPluginContents = 'meaningless contents';

      await fs.promises.mkdir(dockerCLIPluginDest, { mode: 0o755 });
      await fs.promises.writeFile(existingPluginPath, existingPluginContents);

      await integrationManager.enforce();

      const newContents = await fs.promises.readFile(existingPluginPath, 'utf8');

      expect(newContents).toEqual(existingPluginContents);
    });

    test('should update an existing docker CLI plugin that is a dangling symlink', async() => {
      const existingPluginPath = path.join(dockerCLIPluginDest, 'docker-compose');
      const nonExistentPath = '/somepaththatshouldnevereverexist';
      const expectedTarget = path.join(integrationDir, 'docker-compose');

      await fs.promises.mkdir(dockerCLIPluginDest, { mode: 0o755 });
      await fs.promises.symlink(nonExistentPath, existingPluginPath);

      await integrationManager.enforce();

      const newTarget = await fs.promises.readlink(existingPluginPath);

      expect(newTarget).toEqual(expectedTarget);
    });

    test('should update an existing docker CLI plugin whose target is resources directory', async() => {
      const existingPluginPath = path.join(dockerCLIPluginDest, 'docker-compose');
      const sourceDir = path.join(dockerCLIPluginSource, 'docker-compose');
      const expectedTarget = path.join(integrationDir, 'docker-compose');

      await fs.promises.mkdir(dockerCLIPluginDest, { mode: 0o755 });
      await fs.promises.symlink(sourceDir, existingPluginPath);

      await integrationManager.enforce();

      const newTarget = await fs.promises.readlink(existingPluginPath);

      expect(newTarget).toEqual(expectedTarget);
    });

    test('should be idempotent', async() => {
      await integrationManager.enforce();
      const intDirAfterFirstCall = await fs.promises.readdir(integrationDir);
      const dockerCliDirAfterFirstCall = await fs.promises.readdir(dockerCLIPluginDest);

      await integrationManager.enforce();
      const intDirAfterSecondCall = await fs.promises.readdir(integrationDir);
      const dockerCliDirAfterSecondCall = await fs.promises.readdir(dockerCLIPluginDest);

      expect(intDirAfterFirstCall).toEqual(intDirAfterSecondCall);
      expect(dockerCliDirAfterFirstCall).toEqual(dockerCliDirAfterSecondCall);
    });

    test('should convert a regular file in integration directory to correct symlink', async() => {
      const integrationPath = path.join(integrationDir, 'kubectl');
      const expectedTarget = path.join(binDir, 'kubectl');

      await fs.promises.mkdir(integrationDir);
      await fs.promises.writeFile(integrationPath, 'contents', 'utf-8');
      await integrationManager.enforce();
      await expect(fs.promises.readlink(integrationPath)).resolves.toEqual(expectedTarget);
    });

    test('should fix an incorrect symlink in integration directory', async() => {
      const integrationPath = path.join(integrationDir, 'kubectl');
      const originalTargetPath = path.join(testDir, 'kubectl');
      const expectedTarget = path.join(binDir, 'kubectl');

      await fs.promises.mkdir(integrationDir);
      await fs.promises.writeFile(originalTargetPath, 'contents', 'utf-8');
      await fs.promises.symlink(originalTargetPath, integrationPath);
      await integrationManager.enforce();
      await expect(fs.promises.readlink(integrationPath)).resolves.toEqual(expectedTarget);
    });

    test('should fix a dangling symlink in integration directory', async() => {
      const integrationPath = path.join(integrationDir, 'kubectl');
      const originalTargetPath = path.join(testDir, 'kubectl');
      const expectedTarget = path.join(binDir, 'kubectl');

      await fs.promises.mkdir(integrationDir);
      await fs.promises.symlink(originalTargetPath, integrationPath);
      await integrationManager.enforce();
      await expect(fs.promises.readlink(integrationPath)).resolves.toEqual(expectedTarget);
    });

    test('should remove a file that does not have a counterpart in resources directory', async() => {
      const integrationPath = path.join(integrationDir, 'nameThatShouldNeverBeInResourcesDir');

      await fs.promises.mkdir(integrationDir);
      await fs.promises.writeFile(integrationPath, 'content', 'utf-8');
      await integrationManager.enforce();
      await expect(fs.promises.readFile(integrationPath, 'utf-8')).rejects.toThrow('ENOENT');
    });

    test('should not modify a docker plugin that does not have a counterpart in resources directory', async() => {
      const dockerCliPluginPath = path.join(dockerCLIPluginDest, 'nameThatShouldNeverBeInResourcesDir');
      const content = 'content';

      await fs.promises.mkdir(dockerCLIPluginDest);
      await fs.promises.writeFile(dockerCliPluginPath, content, 'utf-8');
      await integrationManager.enforce();
      await expect(fs.promises.readFile(dockerCliPluginPath, 'utf-8')).resolves.toEqual(content);
    });
  });

  describe('remove', () => {
    test('should remove symlinks and dirs properly', async() => {
      await createTestSymlinks(integrationDir, dockerCLIPluginDest);

      await integrationManager.remove();
      await expect(fs.promises.readdir(integrationDir)).rejects.toThrow();
      await expect(fs.promises.readdir(dockerCLIPluginDest)).resolves.toEqual([]);
    });

    test('should not remove an existing docker CLI plugin that is a regular file', async() => {
      // create existing plugin
      const existingPluginPath = path.join(dockerCLIPluginDest, 'docker-compose');
      const existingPluginContents = 'meaningless contents';

      await fs.promises.mkdir(dockerCLIPluginDest, { mode: 0o755 });
      await fs.promises.writeFile(existingPluginPath, existingPluginContents);

      await integrationManager.remove();

      const newContents = await fs.promises.readFile(existingPluginPath, 'utf8');

      expect(newContents).toEqual(existingPluginContents);
    });

    test('should not remove an existing docker CLI plugin that is not an expected symlink', async() => {
      const dockerCliPluginPath = path.join(dockerCLIPluginDest, 'docker-compose');
      const existingTarget = path.join(testDir, 'docker-compose');
      const existingPluginContents = 'meaningless contents';

      await fs.promises.mkdir(dockerCLIPluginDest, { mode: 0o755 });
      await fs.promises.writeFile(existingTarget, existingPluginContents);
      await fs.promises.symlink(existingTarget, dockerCliPluginPath);

      await integrationManager.remove();

      await expect(fs.promises.readlink(dockerCliPluginPath, 'utf8')).resolves.toEqual(existingTarget);
    });

    test('should remove an existing docker CLI plugin that is a dangling symlink', async() => {
      const dockerCliPluginPath = path.join(dockerCLIPluginDest, 'docker-compose');
      const existingTarget = path.join(testDir, 'docker-compose');

      await fs.promises.mkdir(dockerCLIPluginDest, { mode: 0o755 });
      await fs.promises.symlink(existingTarget, dockerCliPluginPath);

      await integrationManager.remove();

      await expect(fs.promises.readlink(dockerCliPluginPath, 'utf8')).rejects.toThrow('ENOENT');
    });

    test('should be idempotent', async() => {
      await integrationManager.remove();
      const testDirAfterFirstCall = await fs.promises.readdir(testDir);

      expect(testDirAfterFirstCall).not.toContain(INTEGRATION_DIR_NAME);
      const dockerCliDirAfterFirstCall = await fs.promises.readdir(dockerCLIPluginDest);

      expect(dockerCliDirAfterFirstCall).toEqual([]);

      await integrationManager.remove();
      const testDirAfterSecondCall = await fs.promises.readdir(testDir);

      expect(testDirAfterSecondCall).not.toContain(INTEGRATION_DIR_NAME);
      const dockerCliDirAfterSecondCall = await fs.promises.readdir(dockerCLIPluginDest);

      expect(dockerCliDirAfterFirstCall).toEqual(dockerCliDirAfterSecondCall);
    });
  });

  describe('removeSymlinksOnly', () => {
    test('should remove symlinks but not integration directory', async() => {
      await createTestSymlinks(integrationDir, dockerCLIPluginDest);

      await integrationManager.removeSymlinksOnly();
      await expect(fs.promises.readdir(integrationDir)).resolves.toEqual([]);
      await expect(fs.promises.readdir(dockerCLIPluginDest)).resolves.toEqual([]);
    });
  });

  describe('weOwnDockerCliFile', () => {
    let dstPath: string;
    const credHelper = 'docker-credential-pass';

    beforeEach(async() => {
      await fs.promises.mkdir(dockerCLIPluginDest, { recursive: true, mode: 0o755 });
      dstPath = path.join(dockerCLIPluginDest, credHelper);
    });

    test("should return true when the symlink's target matches the integration directory", async() => {
      const resourcesPath = path.join(dockerCLIPluginSource, credHelper);
      const srcPath = path.join(integrationDir, credHelper);

      // create symlink in integration dir; otherwise, it is dangling
      await fs.promises.mkdir(integrationDir);
      await fs.promises.symlink(resourcesPath, srcPath);

      await fs.promises.symlink(srcPath, dstPath);
      expect(integrationManager['weOwnDockerCliFile'](dstPath)).resolves.toEqual(true);
    });

    test("should return true when the symlink's target matches the resources directory", async() => {
      const srcPath = path.join(dockerCLIPluginSource, credHelper);

      await fs.promises.symlink(srcPath, dstPath);
      expect(integrationManager['weOwnDockerCliFile'](dstPath)).resolves.toEqual(true);
    });

    test('should return true when the file is a dangling symlink', async() => {
      const srcPath = path.join(testDir, 'testfilethatdoesntexist');

      await fs.promises.symlink(srcPath, dstPath);
      expect(integrationManager['weOwnDockerCliFile'](dstPath)).resolves.toEqual(true);
    });

    test("should return false when the symlink's target doesn't match the integration or resources directory", async() => {
      const srcPath = path.join(testDir, 'someothername');

      await fs.promises.writeFile(srcPath, 'some content', 'utf-8');
      await fs.promises.symlink(srcPath, dstPath);
      expect(integrationManager['weOwnDockerCliFile'](dstPath)).resolves.toEqual(false);
    });

    test('should return false when the file is not a symlink', async() => {
      const contents = 'this is a regular file for testing';

      await fs.promises.writeFile(dstPath, contents, 'utf-8');
      expect(integrationManager['weOwnDockerCliFile'](dstPath)).resolves.toEqual(false);
    });
  });
});

describeUnix('ensureSymlink', () => {
  const srcPath = path.join(dockerCLIPluginSource, 'kubectl');
  let dstPath: string;

  beforeEach(() => {
    dstPath = path.join(testDir, 'kubectl');
  });

  test("should create the symlink if it doesn't exist", async() => {
    const dirContentsBefore = await fs.promises.readdir(testDir);

    expect(dirContentsBefore).toEqual([]);

    await ensureSymlink(srcPath, dstPath);

    return fs.promises.readlink(dstPath);
  });

  test('should do nothing if file is correct symlink', async() => {
    await fs.promises.symlink(srcPath, dstPath);
    await ensureSymlink(srcPath, dstPath);

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
    await ensureSymlink(srcPath, dstPath);

    const newTarget = await fs.promises.readlink(dstPath);

    expect(newTarget).toEqual(srcPath);
  });

  test('should replace a regular file with a symlink', async() => {
    // create the non-symlink dst file
    const contents = 'these contents should be replaced';

    await fs.promises.writeFile(dstPath, contents);
    await ensureSymlink(srcPath, dstPath);

    const newTarget = await fs.promises.readlink(dstPath);

    expect(newTarget).toEqual(srcPath);
  });
});
