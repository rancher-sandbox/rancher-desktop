import fs from 'fs';
import path from 'path';

import ImageBuildOutputCuller from '@/utils/processOutputInterpreters/image-build-output';

describe('image build output', () => {
  it('returns the raw text back', () => {
    const buildOutputPath = path.join('./pkg/rancher-desktop/utils/processOutputInterpreters/__tests__/assets', 'build.txt');
    const data = fs.readFileSync(buildOutputPath).toString();
    const culler = new ImageBuildOutputCuller();

    culler.addData(data);
    expect(culler.getProcessedData()).toBe(data.replace(/\r/g, ''));
  });
});
