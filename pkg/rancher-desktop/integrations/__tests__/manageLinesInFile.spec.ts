import fs from 'fs';
import os from 'os';
import path from 'path';

import manageLinesInFile, { START_LINE, END_LINE } from '@pkg/integrations/manageLinesInFile';

const FILE_NAME = 'fakercfile';
const TEST_LINE_1 = 'this is test line 1';
const TEST_LINE_2 = 'this is test line 2';

let testDir = '';
let rcFilePath = '';

beforeEach(async() => {
  testDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'rdtest-'));
  rcFilePath = path.join(testDir, FILE_NAME);
});

afterEach(async() => {
  // It is best to be careful around rm's; we don't want to remove important things.
  if (testDir) {
    await fs.promises.rm(testDir, { recursive: true, force: true });
  }
});

test("Create file when true and it doesn't yet exist", async() => {
  await manageLinesInFile(rcFilePath, [TEST_LINE_1], true);
  const content = await fs.promises.readFile(rcFilePath, 'utf8');
  const expectedContents = `${ START_LINE }
${ TEST_LINE_1 }
${ END_LINE }`;

  expect(content.replace(/\r\n/g, '\n')).toBe(expectedContents.replace(/\r\n/g, '\n'));
});

test('Delete file when false and it contains only the managed lines', async() => {
  const data = `${ START_LINE }
${ TEST_LINE_1 }
${ END_LINE }`;

  await fs.promises.writeFile(rcFilePath, data, { mode: 0o644 });
  await manageLinesInFile(rcFilePath, [TEST_LINE_1], false);
  expect(fs.promises.readFile(rcFilePath, 'utf8')).rejects.toHaveProperty('code', 'ENOENT');
});

test('Put lines in file that exists and has content', async() => {
  const data = 'this is already present in the file\n';

  await fs.promises.writeFile(rcFilePath, data, { mode: 0o644 });
  await manageLinesInFile(rcFilePath, [TEST_LINE_1], true);
  const content = await fs.promises.readFile(rcFilePath, 'utf8');
  const expectedContents = `${ data }
${ START_LINE }
${ TEST_LINE_1 }
${ END_LINE }`;

  expect(content.replace(/\r\n/g, '\n')).toBe(expectedContents.replace(/\r\n/g, '\n'));
});

test('Remove lines from file that exists and has content', async() => {
  const unmanagedContents = 'this is already present in the file\n';
  const contents = `${ unmanagedContents }
${ START_LINE }
${ TEST_LINE_1 }
${ END_LINE }`;

  await fs.promises.writeFile(rcFilePath, contents, { mode: 0o644 });
  await manageLinesInFile(rcFilePath, [TEST_LINE_1], false);
  const newContents = await fs.promises.readFile(rcFilePath, 'utf8');

  expect(newContents.replace(/\r\n/g, '\n')).toBe(unmanagedContents.replace(/\r\n/g, '\n'));
});

test('Update managed lines', async() => {
  const topUnmanagedContents = 'this is at the top of the file\n';
  const bottomUnmanagedContents = 'this is at the bottom of the file\n';
  const contents = `${ topUnmanagedContents }
${ START_LINE }
${ TEST_LINE_1 }
${ END_LINE }
${ bottomUnmanagedContents }`;

  await fs.promises.writeFile(rcFilePath, contents, { mode: 0o644 });
  await manageLinesInFile(rcFilePath, [TEST_LINE_1, TEST_LINE_2], true);
  const newContents = await fs.promises.readFile(rcFilePath, 'utf8');
  const expectedNewContents = `${ topUnmanagedContents }
${ START_LINE }
${ TEST_LINE_1 }
${ TEST_LINE_2 }
${ END_LINE }
${ bottomUnmanagedContents }`;

  expect(newContents.replace(/\r\n/g, '\n')).toBe(expectedNewContents.replace(/\r\n/g, '\n'));
});

test('Remove managed lines from between unmanaged lines', async() => {
  const topUnmanagedContents = 'this is at the top of the file\n';
  const bottomUnmanagedContents = 'this is at the bottom of the file\n';
  const contents = `${ topUnmanagedContents }
${ START_LINE }
${ TEST_LINE_1 }
${ END_LINE }
${ bottomUnmanagedContents }`;

  await fs.promises.writeFile(rcFilePath, contents, { mode: 0o644 });
  await manageLinesInFile(rcFilePath, [TEST_LINE_1], false);
  const newContents = await fs.promises.readFile(rcFilePath, 'utf8');
  const expectedNewContents = `${ topUnmanagedContents }
${ bottomUnmanagedContents }`;

  expect(newContents.replace(/\r\n/g, '\n')).toBe(expectedNewContents);
});

test('File mode should not be changed when updating a file', async() => {
  const unmanagedContents = 'this is already present in the file\n';
  const contents = `${ unmanagedContents }
${ START_LINE }
${ TEST_LINE_1 }
${ END_LINE }`;

  await fs.promises.writeFile(rcFilePath, contents, { mode: 0o623 });
  const oldFileMode = (await fs.promises.stat(rcFilePath)).mode;

  await manageLinesInFile(rcFilePath, [TEST_LINE_1], false);
  const newFileMode = (await fs.promises.stat(rcFilePath)).mode;

  expect(newFileMode).toBe(oldFileMode);
});

test('Do nothing when desiredPresent is false and file does not exist', async() => {
  await expect(manageLinesInFile(rcFilePath, [TEST_LINE_1], false)).resolves.not.toThrow();
});
