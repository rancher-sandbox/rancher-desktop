import fs from 'fs';
import path from 'path';

import KimBuildOutputCuller from '@/utils/processOutputInterpreters/kim-build-output';

describe('kim build output', () => {
  it('returns the raw text back', () => {
    const buildOutputPath = path.join('./src/utils/processOutputInterpreters/__tests__/assets', 'build.txt');
    const data = fs.readFileSync(buildOutputPath).toString();
    const culler = new KimBuildOutputCuller();

    culler.addData(data);
    expect(culler.getProcessedData()).toBe(data.replace(/\r/g, ''));
  });
});
