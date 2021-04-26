import fs from 'fs';
import path from 'path';

import AnsiOutputInterpreter from '@/utils/processOutputInterpreters/kim-ansi';

describe('more ansi kim output', () => {
  describe('build', () => {
    it('interprets some ansi-sequences', () => {
      const fname = path.join('./src/utils/processOutputInterpreters/__tests__/assets', 'build.txt');
      const data = fs.readFileSync(fname).toString();
      const lines = data.split(/(\r?\n)/);
      const culler = new AnsiOutputInterpreter();

      expect(lines.length).toBeGreaterThan(6);
      culler.addData(lines.slice(0, 2 * 4).join(''));
      let processedLines = culler.getProcessedData().split(/\r?\n/);

      expect(processedLines.length).toBe(3);
      expect(processedLines[0]).toMatch('[+] Building 0.2s (2/3)');
      expect(processedLines[1]).toMatch(/ => \[internal\] load build definition from Dockerfile\s+[\d.]+s/);
      expect(processedLines[2]).toMatch(/ => => transferring dockerfile: 669B\s+[\d.]+s/);

      culler.addData(lines.slice(2 * 4, 2 * 7).join(''));
      processedLines = culler.getProcessedData().split(/\r?\n/);
      expect(processedLines.length).toBe(6);
      expect(processedLines[0]).toMatch('[+] Building 0.2s (2/3)');
      expect(processedLines[1]).toMatch(/^ => \[internal\] load build definition from Dockerfile\s+[\d.]+s/);
      expect(processedLines[2]).toMatch(/^ => => transferring dockerfile: 669B\s+[\d.]+s/);
      expect(processedLines[3]).toMatch(/^ => \[internal\] load .dockerignore\s+[\d.]+s/);
      expect(processedLines[4]).toMatch(/^ => => transferring context: 2B\s+[\d.]+s/);
      expect(processedLines[5]).toMatch(/^ => \[internal\] load metadata for docker\.io\/library\/golang:1-alpine\s+[\d.]+s/);

      culler.addData(lines.slice(2 * 7, 2 * 13).join('')); // lines 7 - 13
      processedLines = culler.getProcessedData().split(/\r?\n/);
      expect(processedLines.length).toBe(6);
      expect(processedLines[0]).toMatch('[+] Building 0.3s (2/3)');
      expect(processedLines[1]).toMatch(/^ => \[internal\] load build definition from Dockerfile\s+[\d.]+s$/);
      expect(processedLines[2]).toMatch(/^ => => transferring dockerfile: 669B\s+[\d.]+s$/);
      expect(processedLines[3]).toMatch(/^ => \[internal\] load .dockerignore\s+[\d.]+s$/);
      expect(processedLines[4]).toMatch(/^ => => transferring context: 2B\s+[\d.]+s$/);
      expect(processedLines[5]).toMatch(/^ => \[internal\] load metadata for docker\.io\/library\/golang:1-alpine\s+[\d.]+s$/);

      // lines 13 - 79
      culler.addData(lines.slice(2 * 13, 2 * 13 + 2 * 6 * 11).join(''));
      processedLines = culler.getProcessedData().split(/\r?\n/);
      expect(processedLines.length).toBe(6);
      expect(processedLines[0]).toMatch('[+] Building 2.0s (2/3)');
      expect(processedLines[1]).toMatch(/^ => \[internal\] load build definition from Dockerfile\s+[\d.]+s$/);
      expect(processedLines[2]).toMatch(/^ => => transferring dockerfile: 669B\s+[\d.]+s$/);
      expect(processedLines[3]).toMatch(/^ => \[internal\] load .dockerignore\s+[\d.]+s$/);
      expect(processedLines[4]).toMatch(/^ => => transferring context: 2B\s+[\d.]+s$/);
      expect(processedLines[5]).toMatch(/^ => \[internal\] load metadata for docker\.io\/library\/golang:1-alpine\s+[\d.]+s$/);

      // lines 79-88
      culler.addData(lines.slice(79 * 2, 2 * 79 + 2 * 9).join(''));
      processedLines = culler.getProcessedData().split(/\r?\n/);
      expect(processedLines.length).toBe(9);
      expect(processedLines[0]).toMatch('[+] Building 2.1s (4/15)');
      expect(processedLines[1]).toMatch(/^ => \[internal\] load build definition from Dockerfile\s+[\d.]+s$/);
      expect(processedLines[2]).toMatch(/^ => => transferring dockerfile: 669B\s+[\d.]+s$/);
      expect(processedLines[3]).toMatch(/^ => \[internal\] load .dockerignore\s+[\d.]+s$/);
      expect(processedLines[4]).toMatch(/^ => => transferring context: 2B\s+[\d.]+s$/);
      expect(processedLines[5]).toMatch(/^ => \[internal\] load metadata for docker\.io\/library\/golang:1-alpine\s+[\d.]+s$/);
      expect(processedLines[6]).toMatch(/^ => \[builder 1\/8\] FROM docker.io\/library\/golang:1-alpine@sha256:49c07aa83790aca732250c2258b5912659df31b6bfa2ab428661\s+[\d.]+s$/);
      expect(processedLines[7]).toMatch(/^ => => resolve docker.io\/library\/golang:1-alpine@sha256:49c07aa83790aca732250c2258b5912659df31b6bfa2ab428661bc668337\s+[\d.]+s$/);
      expect(processedLines[8]).toMatch(/^ => \[internal\] load build context\s+[\d.]+s$/);

      // lines 88-113
      culler.addData(lines.slice(88 * 2, 114*2).join(''));
      processedLines = culler.getProcessedData().split(/\r?\n/);
      expect(processedLines.length).toBe(15);
      expect(processedLines[0]).toMatch('[+] Building 2.4s (4/15)');
      expect(processedLines[1]).toMatch(/^ => \[internal\] load build definition from Dockerfile\s+[\d.]+s$/);
      expect(processedLines[2]).toMatch(/^ => => transferring dockerfile: 669B\s+[\d.]+s$/);
      expect(processedLines[3]).toMatch(/^ => \[internal\] load .dockerignore\s+[\d.]+s$/);
      expect(processedLines[4]).toMatch(/^ => => transferring context: 2B\s+[\d.]+s$/);
      expect(processedLines[5]).toMatch(/^ => \[internal\] load metadata for docker\.io\/library\/golang:1-alpine\s+[\d.]+s$/);
      expect(processedLines[6]).toMatch(/^ => \[builder 1\/8\] FROM docker.io\/library\/golang:1-alpine@sha256:49c07aa83790aca732250c2258b5912659df31b6bfa2ab428661\s+[\d.]+s$/);
      expect(processedLines[7]).toMatch(/^ => => resolve docker.io\/library\/golang:1-alpine@sha256:49c07aa83790aca732250c2258b5912659df31b6bfa2ab428661bc668337\s+[\d.]+s$/);
      expect(processedLines[8]).toMatch(/^ => => sha256:adcc1eea9eeabb6de296adb3e0c1b0722cf13251ff3e4e2d0a5f7ed8e3d48342.*?[\d.]+s$/);
      expect(processedLines[9]).toMatch(/^ => => sha256:0510c868ecb4537a06149c7336217ecc57426cbade1e78dc5f5b9214ce925dab.*?[\d.]+s$/);
      expect(processedLines[10]).toMatch(/^ => => sha256:4c4ab2625f07be8d5c6e48046a05ff3ecc7f374b794a926fb62247b66b511909.*?[\d.]+s$/);
      expect(processedLines[11]).toMatch(/^ => => sha256:afea3b2eda06482098bc605cb2ee7e3170dea8e719423cd084ebb4b8b97fcafc.*?[\d.]+s$/);
      expect(processedLines[12]).toMatch(/^ => => sha256:540db60ca9383eac9e418f78490994d0af424aab7bf6d0e47ac8ed4e2e9bcbba.*?[\d.]+s$/);
      expect(processedLines[13]).toMatch(/^ => \[internal\] load build context.*[\d.]+s$/);
      expect(processedLines[14]).toMatch(/^ => => transferring context.*[\d.]+s$/);

      // Dump in the rest
      culler.addData(lines.slice(114*2).join(''));
      processedLines = culler.getProcessedData().split(/\r?\n/);
      expect(processedLines.length).toBe(35);
      expect(processedLines[0]).toMatch('[+] Building 22.5s (16/16) FINISHED');
      expect(processedLines[9]).toMatch(/^ => => sha256:0510c868ecb4537a06149c7336217ecc57426cbade1e78dc5f5b9214ce925dab.*?[\d.]+s$/);
      expect(processedLines[16]).toMatch(/^ => => extracting sha256:0510c868ecb4537a06149c7336217ecc57426cbade1e78dc5f5b9214ce925dab.*?[\d.]+s$/);
      expect(processedLines[23]).toMatch(/^ => \[builder 5\/8\] COPY go\.sum \..*[\d.]+s$/);
      expect(processedLines[30]).toMatch(/^ => exporting to image.*[\d.]+s$/);
      expect(processedLines[31]).toMatch(/^ => => exporting layers.*[\d.]+s$/);
      expect(processedLines[32]).toMatch(/^ => => exporting manifest sha256:2c5329d378f47bb3707e8d7517502b210c88a05caabac4a7800e341f1cecee39.*[\d.]+s$/);
      expect(processedLines[33]).toMatch(/^ => => exporting config sha256:66988f43f3e828654db75551b5b3e8a6325f2a4f6e9084aabb3195120580fdcf.*[\d.]+s$/);
      expect(processedLines[34]).toMatch(/^ => => naming to docker.io\/library\/whoami:v101.*[\d.]+s$/);
    });
  });
});
