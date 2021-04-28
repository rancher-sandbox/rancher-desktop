import fs from 'fs';
import path from 'path';

import BuildImageOutputCuller from '@/utils/processOutputInterpreters/kim-ansi';

describe('kim build output', () => {
  it('returns the raw text back', () => {
    const buildOutputPath = path.join('./src/utils/processOutputInterpreters/__tests__/assets', 'build.txt');
    const data = fs.readFileSync(buildOutputPath).toString();
    const culler = new BuildImageOutputCuller();

    culler.addData(data);
    expect(culler.getProcessedData()).toBe(data);
  });
});
