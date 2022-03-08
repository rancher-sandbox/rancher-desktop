import fs from 'fs';
import os from 'os';
import path from 'path';
import { manageLinesInFile, START_LINE, END_LINE } from '@/integrations/rdFileManager';

const FILE_NAME = 'fakercfile';
const TEST_LINE_1 = 'this is test line 1';

let TEST_DIR = ''

beforeEach(async() => {
  TEST_DIR = await fs.promises.mkdtemp(path.join(os.tmpdir(),'rdtest-'));
});

afterEach(async() => {
  await fs.promises.rm(TEST_DIR, {recursive: true, force: true});
});

const EXPECTED_CONTENTS = `${START_LINE}
${TEST_LINE_1}
${END_LINE}`
test("Test that file is created when it doesn't yet exist", async() => {
  const rcFilePath = path.join(TEST_DIR, FILE_NAME);
  await manageLinesInFile(rcFilePath, [TEST_LINE_1], true);
  const content = await fs.promises.readFile(rcFilePath, 'utf8');
  expect(content).toBe(EXPECTED_CONTENTS);
});
