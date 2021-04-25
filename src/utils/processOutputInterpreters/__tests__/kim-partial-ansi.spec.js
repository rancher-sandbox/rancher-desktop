import fs from 'fs';
import path from 'path';

import NonBuildImageOutputCuller from '@/utils/processOutputInterpreters/kim-partial-ansi.ts';

describe('simple kim output', () => {
  describe('push', () => {
    it('culls by SHA', () => {
      const fname = path.join('assets', 'push.txt');
      const data = fs.readFileSync(fname).toString();
      const lines = data.split(/(\r?\n)/);
      const culler = new NonBuildImageOutputCuller();

      expect(lines.length).toBeGreaterThan(6);
      culler.addData(lines.slice(0, 6).join(''));
      const processedLines = culler.getProcessedData().split(/\r?\n/);

      expect(processedLines[0]).toBe('line1');
      expect(processedLines[0]).toBe('line2');
      expect(processedLines[0]).toBe('line3');
    });
  });
});
