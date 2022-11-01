import fs from 'fs';
import path from 'path';

import TrivyScanImageOutputCuller from '@/utils/processOutputInterpreters/trivy-image-output';

describe('trivy image output', () => {
  it('echoes a zero-vul image back', () => {
    const inputPath = path.join('./pkg/rancher-desktop/utils/processOutputInterpreters/__tests__/assets', 'trivy-image-metric-server-input.txt');
    const outputPath = path.join('./pkg/rancher-desktop/utils/processOutputInterpreters/__tests__/assets', 'trivy-image-metric-server-output.txt');
    const inputData = fs.readFileSync(inputPath).toString();
    const expectedOutputData = fs.readFileSync(outputPath).toString().replace(/\r/g, '');
    const culler = new TrivyScanImageOutputCuller();

    culler.addData(inputData);
    const processedData = culler.getProcessedData();

    expect(expectedOutputData).toEqual(processedData);
  });

  it('converts lines to records and handles inherited cells', () => {
    const inputPath = path.join('./pkg/rancher-desktop/utils/processOutputInterpreters/__tests__/assets', 'trivy-image-postgres-input.txt');
    const outputPath = path.join('./pkg/rancher-desktop/utils/processOutputInterpreters/__tests__/assets', 'trivy-image-postgres-output.txt');
    const inputData = fs.readFileSync(inputPath).toString();
    const expectedOutputData = fs.readFileSync(outputPath).toString().replace(/\r/g, '');
    const culler = new TrivyScanImageOutputCuller();

    culler.addData(inputData);
    const processedData = culler.getProcessedData();

    expect(expectedOutputData).toEqual(processedData);
  });
});
