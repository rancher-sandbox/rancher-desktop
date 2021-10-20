import fs from 'fs';
import path from 'path';

import ImageNonBuildOutputCuller from '@/utils/processOutputInterpreters/image-non-build-output';

describe('simple image output', () => {
  describe('push', () => {
    it('culls by SHA', () => {
      const fname = path.join('./src/utils/processOutputInterpreters/__tests__/assets', 'push.txt');
      const data = fs.readFileSync(fname).toString();
      const lines = data.split(/(\r?\n)/);
      const culler = new ImageNonBuildOutputCuller();

      expect(lines.length).toBeGreaterThan(6);
      culler.addData(lines.slice(0, 24).join(''));
      let processedLines = culler.getProcessedData().split(/\r?\n/);

      expect(processedLines.length).toBe(12);
      expect(processedLines[0]).toMatch(/^config-sha256:4760d6065fe005e991da592c40c14f58abbbed5167e248336b7f5586aa844068:\s+waiting/);
      expect(processedLines[1]).toMatch(/^layer-sha256:056a5bf54c27d99d6ed420ba6cb481647ee99b9c11faacc02110d37f12edc1cf:\s+waiting/);
      expect(processedLines[2]).toMatch(/^layer-sha256:60dde8851b86f5f7adf602f7f2a4dfe4ab45ba8c979ed91105e62db026ee02a3:\s+waiting/);
      expect(processedLines[3]).toMatch(/^layer-sha256:97e34918dcd1d5a4999f8d084f1aed8b9b981a357cab20391ec352e2bf0a2c78:\s+waiting/);
      expect(processedLines[4]).toMatch(/^layer-sha256:9949d7879153e978338242fe30b7b0c4d3207361a227d49d1969c189b43451e5:\s+waiting/);
      expect(processedLines[5]).toMatch(/^layer-sha256:9aae54b2144e5b2b00c610f8805128f4f86822e1e52d3714c463744a431f0f4a:\s+waiting/);
      expect(processedLines[6]).toMatch(/^layer-sha256:9d1f343c69b3579d6f03ab967906427a372d4ac9c921ad6d4d2a288a8be0757d:\s+waiting/);
      expect(processedLines[7]).toMatch(/^layer-sha256:9ef1121d3b90a9befcf2b8ac285e1653eb196a0ce5e8be1320feb09bdb69a967:\s+waiting/);
      expect(processedLines[8]).toMatch(/^layer-sha256:dd3f9c1f5db9ad0120095ff2cef4c467222151487db61f8b9c424ace486e7d04:\s+waiting/);
      expect(processedLines[9]).toMatch(/^layer-sha256:ffed9dad286c82fb74ed76005208eb2195ff464a2619e1484d1d5f6e3538477b:\s+waiting/);
      expect(processedLines[10]).toMatch(/^manifest-sha256:15d001306a2a981e553544aac749ed442cd55de0d889228c0eb083c68bec4f2d:\s+waiting/);
      expect(processedLines[11]).toMatch(/^\s*elapsed: 0.1 s/);

      culler.addData(lines.slice(24, 48).join(''));
      processedLines = culler.getProcessedData().split(/\r?\n/);
      expect(processedLines.length).toBe(12);
      expect(processedLines[0]).toMatch(/^config-sha256:4760d6065fe005e991da592c40c14f58abbbed5167e248336b7f5586aa844068:\s+waiting/);
      expect(processedLines[1]).toMatch(/^layer-sha256:056a5bf54c27d99d6ed420ba6cb481647ee99b9c11faacc02110d37f12edc1cf:\s+waiting/);
      expect(processedLines[2]).toMatch(/^layer-sha256:60dde8851b86f5f7adf602f7f2a4dfe4ab45ba8c979ed91105e62db026ee02a3:\s+waiting/);
      expect(processedLines[3]).toMatch(/^layer-sha256:97e34918dcd1d5a4999f8d084f1aed8b9b981a357cab20391ec352e2bf0a2c78:\s+waiting/);
      expect(processedLines[4]).toMatch(/^layer-sha256:9949d7879153e978338242fe30b7b0c4d3207361a227d49d1969c189b43451e5:\s+waiting/);
      expect(processedLines[5]).toMatch(/^layer-sha256:9aae54b2144e5b2b00c610f8805128f4f86822e1e52d3714c463744a431f0f4a:\s+waiting/);
      expect(processedLines[6]).toMatch(/^layer-sha256:9d1f343c69b3579d6f03ab967906427a372d4ac9c921ad6d4d2a288a8be0757d:\s+waiting/);
      expect(processedLines[7]).toMatch(/^layer-sha256:9ef1121d3b90a9befcf2b8ac285e1653eb196a0ce5e8be1320feb09bdb69a967:\s+waiting/);
      expect(processedLines[8]).toMatch(/^layer-sha256:dd3f9c1f5db9ad0120095ff2cef4c467222151487db61f8b9c424ace486e7d04:\s+waiting/);
      expect(processedLines[9]).toMatch(/^layer-sha256:ffed9dad286c82fb74ed76005208eb2195ff464a2619e1484d1d5f6e3538477b:\s+waiting/);
      expect(processedLines[10]).toMatch(/^manifest-sha256:15d001306a2a981e553544aac749ed442cd55de0d889228c0eb083c68bec4f2d:\s+waiting/);
      expect(processedLines[11]).toMatch(/^\s*elapsed: (?:\d*\.)?\d+\s*s/);

      culler.addData(lines.slice(2 * 12 * 2, 10 * 12 * 2).join(''));
      processedLines = culler.getProcessedData().split(/\r?\n/);
      expect(processedLines.length).toBe(12);
      expect(processedLines[0]).toMatch(/^config-sha256:4760d6065fe005e991da592c40c14f58abbbed5167e248336b7f5586aa844068:\s+waiting/);
      expect(processedLines[1]).toMatch(/^layer-sha256:056a5bf54c27d99d6ed420ba6cb481647ee99b9c11faacc02110d37f12edc1cf:\s+waiting/);
      expect(processedLines[2]).toMatch(/^layer-sha256:60dde8851b86f5f7adf602f7f2a4dfe4ab45ba8c979ed91105e62db026ee02a3:\s+waiting/);
      expect(processedLines[3]).toMatch(/^layer-sha256:97e34918dcd1d5a4999f8d084f1aed8b9b981a357cab20391ec352e2bf0a2c78:\s+waiting/);
      expect(processedLines[4]).toMatch(/^layer-sha256:9949d7879153e978338242fe30b7b0c4d3207361a227d49d1969c189b43451e5:\s+waiting/);
      expect(processedLines[5]).toMatch(/^layer-sha256:9aae54b2144e5b2b00c610f8805128f4f86822e1e52d3714c463744a431f0f4a:\s+waiting/);
      expect(processedLines[6]).toMatch(/^layer-sha256:9d1f343c69b3579d6f03ab967906427a372d4ac9c921ad6d4d2a288a8be0757d:\s+waiting/);
      expect(processedLines[7]).toMatch(/^layer-sha256:9ef1121d3b90a9befcf2b8ac285e1653eb196a0ce5e8be1320feb09bdb69a967:\s+waiting/);
      expect(processedLines[8]).toMatch(/^layer-sha256:dd3f9c1f5db9ad0120095ff2cef4c467222151487db61f8b9c424ace486e7d04:\s+waiting/);
      expect(processedLines[9]).toMatch(/^layer-sha256:ffed9dad286c82fb74ed76005208eb2195ff464a2619e1484d1d5f6e3538477b:\s+waiting/);
      expect(processedLines[10]).toMatch(/^manifest-sha256:15d001306a2a981e553544aac749ed442cd55de0d889228c0eb083c68bec4f2d:\s+waiting/);
      expect(processedLines[11]).toMatch(/^\s*elapsed: (?:\d*\.)?\d+\s*s/);

      culler.addData(lines.slice(10 * 12 * 2, 11 * 12 * 2).join(''));
      processedLines = culler.getProcessedData().split(/\r?\n/);
      expect(processedLines.length).toBe(12);
      expect(processedLines[0]).toMatch(/^config-sha256:4760d6065fe005e991da592c40c14f58abbbed5167e248336b7f5586aa844068:\s+done/);
      expect(processedLines[1]).toMatch(/^layer-sha256:056a5bf54c27d99d6ed420ba6cb481647ee99b9c11faacc02110d37f12edc1cf:\s+waiting/);
      expect(processedLines[2]).toMatch(/^layer-sha256:60dde8851b86f5f7adf602f7f2a4dfe4ab45ba8c979ed91105e62db026ee02a3:\s+done/);
      expect(processedLines[3]).toMatch(/^layer-sha256:97e34918dcd1d5a4999f8d084f1aed8b9b981a357cab20391ec352e2bf0a2c78:\s+waiting/);
      expect(processedLines[4]).toMatch(/^layer-sha256:9949d7879153e978338242fe30b7b0c4d3207361a227d49d1969c189b43451e5:\s+done/);
      expect(processedLines[5]).toMatch(/^layer-sha256:9aae54b2144e5b2b00c610f8805128f4f86822e1e52d3714c463744a431f0f4a:\s+waiting/);
      expect(processedLines[6]).toMatch(/^layer-sha256:9d1f343c69b3579d6f03ab967906427a372d4ac9c921ad6d4d2a288a8be0757d:\s+waiting/);
      expect(processedLines[7]).toMatch(/^layer-sha256:9ef1121d3b90a9befcf2b8ac285e1653eb196a0ce5e8be1320feb09bdb69a967:\s+waiting/);
      expect(processedLines[8]).toMatch(/^layer-sha256:dd3f9c1f5db9ad0120095ff2cef4c467222151487db61f8b9c424ace486e7d04:\s+waiting/);
      expect(processedLines[9]).toMatch(/^layer-sha256:ffed9dad286c82fb74ed76005208eb2195ff464a2619e1484d1d5f6e3538477b:\s+waiting/);
      expect(processedLines[10]).toMatch(/^manifest-sha256:15d001306a2a981e553544aac749ed442cd55de0d889228c0eb083c68bec4f2d:\s+waiting/);
      expect(processedLines[11]).toMatch(/^\s*elapsed: (?:\d*\.)?\d+\s*s/);

      culler.addData(lines.slice(11 * 12 * 2, 12 * 12 * 2).join(''));
      processedLines = culler.getProcessedData().split(/\r?\n/);
      expect(processedLines.length).toBe(12);
      expect(processedLines[0]).toMatch(/^config-sha256:4760d6065fe005e991da592c40c14f58abbbed5167e248336b7f5586aa844068:\s+done/);
      expect(processedLines[1]).toMatch(/^layer-sha256:056a5bf54c27d99d6ed420ba6cb481647ee99b9c11faacc02110d37f12edc1cf:\s+done/);
      expect(processedLines[2]).toMatch(/^layer-sha256:60dde8851b86f5f7adf602f7f2a4dfe4ab45ba8c979ed91105e62db026ee02a3:\s+done/);
      expect(processedLines[3]).toMatch(/^layer-sha256:97e34918dcd1d5a4999f8d084f1aed8b9b981a357cab20391ec352e2bf0a2c78:\s+waiting/);
      expect(processedLines[4]).toMatch(/^layer-sha256:9949d7879153e978338242fe30b7b0c4d3207361a227d49d1969c189b43451e5:\s+done/);
      expect(processedLines[5]).toMatch(/^layer-sha256:9aae54b2144e5b2b00c610f8805128f4f86822e1e52d3714c463744a431f0f4a:\s+waiting/);
      expect(processedLines[6]).toMatch(/^layer-sha256:9d1f343c69b3579d6f03ab967906427a372d4ac9c921ad6d4d2a288a8be0757d:\s+waiting/);
      expect(processedLines[7]).toMatch(/^layer-sha256:9ef1121d3b90a9befcf2b8ac285e1653eb196a0ce5e8be1320feb09bdb69a967:\s+waiting/);
      expect(processedLines[8]).toMatch(/^layer-sha256:dd3f9c1f5db9ad0120095ff2cef4c467222151487db61f8b9c424ace486e7d04:\s+done/);
      expect(processedLines[9]).toMatch(/^layer-sha256:ffed9dad286c82fb74ed76005208eb2195ff464a2619e1484d1d5f6e3538477b:\s+waiting/);
      expect(processedLines[10]).toMatch(/^manifest-sha256:15d001306a2a981e553544aac749ed442cd55de0d889228c0eb083c68bec4f2d:\s+waiting/);
      expect(processedLines[11]).toMatch(/^\s*elapsed: (?:\d*\.)?\d+\s*s/);

      culler.addData(lines.slice(12 * 12 * 2, 13 * 12 * 2).join(''));
      processedLines = culler.getProcessedData().split(/\r?\n/);
      expect(processedLines.length).toBe(12);
      expect(processedLines[0]).toMatch(/^config-sha256:4760d6065fe005e991da592c40c14f58abbbed5167e248336b7f5586aa844068:\s+done/);
      expect(processedLines[1]).toMatch(/^layer-sha256:056a5bf54c27d99d6ed420ba6cb481647ee99b9c11faacc02110d37f12edc1cf:\s+done/);
      expect(processedLines[2]).toMatch(/^layer-sha256:60dde8851b86f5f7adf602f7f2a4dfe4ab45ba8c979ed91105e62db026ee02a3:\s+done/);
      expect(processedLines[3]).toMatch(/^layer-sha256:97e34918dcd1d5a4999f8d084f1aed8b9b981a357cab20391ec352e2bf0a2c78:\s+done/);
      expect(processedLines[4]).toMatch(/^layer-sha256:9949d7879153e978338242fe30b7b0c4d3207361a227d49d1969c189b43451e5:\s+done/);
      expect(processedLines[5]).toMatch(/^layer-sha256:9aae54b2144e5b2b00c610f8805128f4f86822e1e52d3714c463744a431f0f4a:\s+done/);
      expect(processedLines[6]).toMatch(/^layer-sha256:9d1f343c69b3579d6f03ab967906427a372d4ac9c921ad6d4d2a288a8be0757d:\s+waiting/);
      expect(processedLines[7]).toMatch(/^layer-sha256:9ef1121d3b90a9befcf2b8ac285e1653eb196a0ce5e8be1320feb09bdb69a967:\s+done/);
      expect(processedLines[8]).toMatch(/^layer-sha256:dd3f9c1f5db9ad0120095ff2cef4c467222151487db61f8b9c424ace486e7d04:\s+done/);
      expect(processedLines[9]).toMatch(/^layer-sha256:ffed9dad286c82fb74ed76005208eb2195ff464a2619e1484d1d5f6e3538477b:\s+done/);
      expect(processedLines[10]).toMatch(/^manifest-sha256:15d001306a2a981e553544aac749ed442cd55de0d889228c0eb083c68bec4f2d:\s+waiting/);
      expect(processedLines[11]).toMatch(/^\s*elapsed: (?:\d*\.)?\d+\s*s/);

      culler.addData(lines.slice(13 * 12 * 2, 14 * 12 * 2).join(''));
      processedLines = culler.getProcessedData().split(/\r?\n/);
      expect(processedLines.length).toBe(12);
      expect(processedLines[0]).toMatch(/^config-sha256:4760d6065fe005e991da592c40c14f58abbbed5167e248336b7f5586aa844068:\s+done/);
      expect(processedLines[1]).toMatch(/^layer-sha256:056a5bf54c27d99d6ed420ba6cb481647ee99b9c11faacc02110d37f12edc1cf:\s+done/);
      expect(processedLines[2]).toMatch(/^layer-sha256:60dde8851b86f5f7adf602f7f2a4dfe4ab45ba8c979ed91105e62db026ee02a3:\s+done/);
      expect(processedLines[3]).toMatch(/^layer-sha256:97e34918dcd1d5a4999f8d084f1aed8b9b981a357cab20391ec352e2bf0a2c78:\s+done/);
      expect(processedLines[4]).toMatch(/^layer-sha256:9949d7879153e978338242fe30b7b0c4d3207361a227d49d1969c189b43451e5:\s+done/);
      expect(processedLines[5]).toMatch(/^layer-sha256:9aae54b2144e5b2b00c610f8805128f4f86822e1e52d3714c463744a431f0f4a:\s+done/);
      expect(processedLines[6]).toMatch(/^layer-sha256:9d1f343c69b3579d6f03ab967906427a372d4ac9c921ad6d4d2a288a8be0757d:\s+done/);
      expect(processedLines[7]).toMatch(/^layer-sha256:9ef1121d3b90a9befcf2b8ac285e1653eb196a0ce5e8be1320feb09bdb69a967:\s+done/);
      expect(processedLines[8]).toMatch(/^layer-sha256:dd3f9c1f5db9ad0120095ff2cef4c467222151487db61f8b9c424ace486e7d04:\s+done/);
      expect(processedLines[9]).toMatch(/^layer-sha256:ffed9dad286c82fb74ed76005208eb2195ff464a2619e1484d1d5f6e3538477b:\s+done/);
      expect(processedLines[10]).toMatch(/^manifest-sha256:15d001306a2a981e553544aac749ed442cd55de0d889228c0eb083c68bec4f2d:\s+waiting/);
      expect(processedLines[11]).toMatch(/^\s*elapsed: (?:\d*\.)?\d+\s*s/);
    });
  });
  describe('pull', () => {
    it('culls by SHA', () => {
      const fname = path.join('./src/utils/processOutputInterpreters/__tests__/assets', 'pull.txt');
      const data = fs.readFileSync(fname).toString();
      const lines = data.split(/(\r?\n)/);
      const culler = new ImageNonBuildOutputCuller();

      expect(lines.length).toBeGreaterThan(6);
      culler.addData(lines.slice(0, 16).join(''));
      let processedLines = culler.getProcessedData().split(/\r?\n/);

      expect(processedLines.length).toBe(4);
      expect(processedLines[0]).toMatch(/^index-sha256:091ee4779c0d90155b6d1a317855ce64714e6485f9db4413c812ddd112df7dc7:\s+waiting/);
      expect(processedLines[1]).toMatch(/^manifest-sha256:b3a3389753c2b6d682378051ff775b7122ed3a62d708cc73a52a10421b7c7206:\s+waiting/);
      expect(processedLines[2]).toMatch(/^config-sha256:343efcc83bc0172ddd0ab1b2e787cd46712a3dd0551718b978187d8792518375:\s+waiting/);
      expect(processedLines[3]).toMatch(/^\s*elapsed: (?:\d*\.)?\d+\s*s/);

      culler.addData(lines.slice(16, 34).join(''));
      processedLines = culler.getProcessedData().split(/\r?\n/);
      expect(processedLines.length).toBe(12);
      expect(processedLines[0]).toMatch(/^index-sha256:091ee4779c0d90155b6d1a317855ce64714e6485f9db4413c812ddd112df7dc7:\s+waiting/);
      expect(processedLines[1]).toMatch(/^manifest-sha256:b3a3389753c2b6d682378051ff775b7122ed3a62d708cc73a52a10421b7c7206:\s+waiting/);
      expect(processedLines[2]).toMatch(/^config-sha256:343efcc83bc0172ddd0ab1b2e787cd46712a3dd0551718b978187d8792518375:\s+waiting/);
      expect(processedLines[3]).toMatch(/^layer-sha256:3923d444ed0552ce73ef51fa235f1b45edafdec096abda6abab710637dac7ec6:\s+waiting/);
      expect(processedLines[4]).toMatch(/^layer-sha256:44718e6d535d365250316b02459f98a1b0fa490158cc53057d18858507504d60:\s+waiting/);
      expect(processedLines[5]).toMatch(/^layer-sha256:6d245082de987bb6168e91693b43d7e0a7de48a26f500e42acc30ee3fc8ad58e:\s+waiting/);
      expect(processedLines[6]).toMatch(/^layer-sha256:9878c33f813b971dd2ee28563af9275ea845786d8c428ae2abc181f5aecb4c8a:\s+waiting/);
      expect(processedLines[7]).toMatch(/^layer-sha256:bd8f6a7501ccbe80b95c82519ed6fd4f7236a41e0ae59ba4a8df76af24629efc:\s+waiting/);
      expect(processedLines[8]).toMatch(/^layer-sha256:e95942c4e21d00fe2aa7d8d59d745f53b8ee816795b7315f313b4d9625ec373c:\s+waiting/);
      expect(processedLines[9]).toMatch(/^layer-sha256:efe9738af0cb2184ee8f3fb3dcb130455385aa428a27d14e1e07a5587ff16e64:\s+waiting/);
      expect(processedLines[10]).toMatch(/^layer-sha256:f37aabde37b87d272286df45e6a3145b0884b72e07e657bf1a2a1e74a92c6172:\s+waiting/);
      expect(processedLines[11]).toMatch(/^\s*elapsed: (?:\d*\.)?\d+\s*s/);

      culler.addData(lines.slice(34, 34 + 4 * 2 * 9).join(''));
      processedLines = culler.getProcessedData().split(/\r?\n/);
      expect(processedLines.length).toBe(12);
      expect(processedLines[0]).toMatch(/^index-sha256:091ee4779c0d90155b6d1a317855ce64714e6485f9db4413c812ddd112df7dc7:\s+waiting/);
      expect(processedLines[1]).toMatch(/^manifest-sha256:b3a3389753c2b6d682378051ff775b7122ed3a62d708cc73a52a10421b7c7206:\s+waiting/);
      expect(processedLines[2]).toMatch(/^config-sha256:343efcc83bc0172ddd0ab1b2e787cd46712a3dd0551718b978187d8792518375:\s+waiting/);
      expect(processedLines[3]).toMatch(/^layer-sha256:3923d444ed0552ce73ef51fa235f1b45edafdec096abda6abab710637dac7ec6:\s+waiting/);
      expect(processedLines[4]).toMatch(/^layer-sha256:44718e6d535d365250316b02459f98a1b0fa490158cc53057d18858507504d60:\s+waiting/);
      expect(processedLines[5]).toMatch(/^layer-sha256:6d245082de987bb6168e91693b43d7e0a7de48a26f500e42acc30ee3fc8ad58e:\s+waiting/);
      expect(processedLines[6]).toMatch(/^layer-sha256:9878c33f813b971dd2ee28563af9275ea845786d8c428ae2abc181f5aecb4c8a:\s+waiting/);
      expect(processedLines[7]).toMatch(/^layer-sha256:bd8f6a7501ccbe80b95c82519ed6fd4f7236a41e0ae59ba4a8df76af24629efc:\s+waiting/);
      expect(processedLines[8]).toMatch(/^layer-sha256:e95942c4e21d00fe2aa7d8d59d745f53b8ee816795b7315f313b4d9625ec373c:\s+waiting/);
      expect(processedLines[9]).toMatch(/^layer-sha256:efe9738af0cb2184ee8f3fb3dcb130455385aa428a27d14e1e07a5587ff16e64:\s+waiting/);
      expect(processedLines[10]).toMatch(/^layer-sha256:f37aabde37b87d272286df45e6a3145b0884b72e07e657bf1a2a1e74a92c6172:\s+waiting/);
      expect(processedLines[11]).toMatch(/^\s*elapsed: (?:\d*\.)?\d+\s*s/);

      culler.addData(lines.slice(34 + 4 * 2 * 9, 34 + 4 * 2 * 9 + 2 * 7).join(''));
      processedLines = culler.getProcessedData().split(/\r?\n/);
      expect(processedLines.length).toBe(12);
      expect(processedLines[0]).toMatch(/^index-sha256:091ee4779c0d90155b6d1a317855ce64714e6485f9db4413c812ddd112df7dc7:\s+waiting/);
      expect(processedLines[1]).toMatch(/^manifest-sha256:b3a3389753c2b6d682378051ff775b7122ed3a62d708cc73a52a10421b7c7206:\s+waiting/);
      expect(processedLines[2]).toMatch(/^config-sha256:343efcc83bc0172ddd0ab1b2e787cd46712a3dd0551718b978187d8792518375:\s+waiting/);
      expect(processedLines[3]).toMatch(/^layer-sha256:3923d444ed0552ce73ef51fa235f1b45edafdec096abda6abab710637dac7ec6:\s+waiting/);
      expect(processedLines[4]).toMatch(/^layer-sha256:44718e6d535d365250316b02459f98a1b0fa490158cc53057d18858507504d60:\s+waiting/);
      expect(processedLines[5]).toMatch(/^layer-sha256:6d245082de987bb6168e91693b43d7e0a7de48a26f500e42acc30ee3fc8ad58e:\s+waiting/);
      expect(processedLines[6]).toMatch(/^layer-sha256:9878c33f813b971dd2ee28563af9275ea845786d8c428ae2abc181f5aecb4c8a:\s+waiting/);
      expect(processedLines[7]).toMatch(/^layer-sha256:bd8f6a7501ccbe80b95c82519ed6fd4f7236a41e0ae59ba4a8df76af24629efc:\s+waiting/);
      expect(processedLines[8]).toMatch(/^layer-sha256:e95942c4e21d00fe2aa7d8d59d745f53b8ee816795b7315f313b4d9625ec373c:\s+waiting/);
      expect(processedLines[9]).toMatch(/^layer-sha256:efe9738af0cb2184ee8f3fb3dcb130455385aa428a27d14e1e07a5587ff16e64:\s+waiting/);
      expect(processedLines[10]).toMatch(/^layer-sha256:f37aabde37b87d272286df45e6a3145b0884b72e07e657bf1a2a1e74a92c6172:\s+waiting/);
      expect(processedLines[11]).toMatch(/^\s*elapsed: (?:\d*\.)?\d+\s*s/);

      culler.addData(lines.slice(34 + 4 * 2 * 9 + 2 * 7, 34 + 4 * 2 * 9 + 4 * 8).join(''));
      processedLines = culler.getProcessedData().split(/\r?\n/);
      expect(processedLines.length).toBe(12);
      expect(processedLines[0]).toMatch(/^index-sha256:091ee4779c0d90155b6d1a317855ce64714e6485f9db4413c812ddd112df7dc7:\s+waiting/);
      expect(processedLines[1]).toMatch(/^manifest-sha256:b3a3389753c2b6d682378051ff775b7122ed3a62d708cc73a52a10421b7c7206:\s+waiting/);
      expect(processedLines[2]).toMatch(/^config-sha256:343efcc83bc0172ddd0ab1b2e787cd46712a3dd0551718b978187d8792518375:\s+waiting/);
      expect(processedLines[3]).toMatch(/^layer-sha256:3923d444ed0552ce73ef51fa235f1b45edafdec096abda6abab710637dac7ec6:\s+downloading/);
      expect(processedLines[4]).toMatch(/^layer-sha256:44718e6d535d365250316b02459f98a1b0fa490158cc53057d18858507504d60:\s+waiting/);
      expect(processedLines[5]).toMatch(/^layer-sha256:6d245082de987bb6168e91693b43d7e0a7de48a26f500e42acc30ee3fc8ad58e:\s+waiting/);
      expect(processedLines[6]).toMatch(/^layer-sha256:9878c33f813b971dd2ee28563af9275ea845786d8c428ae2abc181f5aecb4c8a:\s+waiting/);
      expect(processedLines[7]).toMatch(/^layer-sha256:bd8f6a7501ccbe80b95c82519ed6fd4f7236a41e0ae59ba4a8df76af24629efc:\s+waiting/);
      expect(processedLines[8]).toMatch(/^layer-sha256:e95942c4e21d00fe2aa7d8d59d745f53b8ee816795b7315f313b4d9625ec373c:\s+waiting/);
      expect(processedLines[9]).toMatch(/^layer-sha256:efe9738af0cb2184ee8f3fb3dcb130455385aa428a27d14e1e07a5587ff16e64:\s+downloading/);
      expect(processedLines[10]).toMatch(/^layer-sha256:f37aabde37b87d272286df45e6a3145b0884b72e07e657bf1a2a1e74a92c6172:\s+downloading/);
      expect(processedLines[11]).toMatch(/^\s*elapsed: (?:\d*\.)?\d+\s*s/);

      culler.addData(lines.slice(34 + 4 * 2 * 9 + 4 * 8).join(''));
      processedLines = culler.getProcessedData().split(/\r?\n/);
      expect(processedLines.length).toBe(12);
      expect(processedLines[0]).toMatch(/^index-sha256:091ee4779c0d90155b6d1a317855ce64714e6485f9db4413c812ddd112df7dc7:\s+waiting/);
      expect(processedLines[1]).toMatch(/^manifest-sha256:b3a3389753c2b6d682378051ff775b7122ed3a62d708cc73a52a10421b7c7206:\s+waiting/);
      expect(processedLines[2]).toMatch(/^config-sha256:343efcc83bc0172ddd0ab1b2e787cd46712a3dd0551718b978187d8792518375:\s+waiting/);
      expect(processedLines[3]).toMatch(/^layer-sha256:3923d444ed0552ce73ef51fa235f1b45edafdec096abda6abab710637dac7ec6:\s+downloading/);
      expect(processedLines[4]).toMatch(/^layer-sha256:44718e6d535d365250316b02459f98a1b0fa490158cc53057d18858507504d60:\s+downloading/);
      expect(processedLines[5]).toMatch(/^layer-sha256:6d245082de987bb6168e91693b43d7e0a7de48a26f500e42acc30ee3fc8ad58e:\s+waiting/);
      expect(processedLines[6]).toMatch(/^layer-sha256:9878c33f813b971dd2ee28563af9275ea845786d8c428ae2abc181f5aecb4c8a:\s+downloading/);
      expect(processedLines[7]).toMatch(/^layer-sha256:bd8f6a7501ccbe80b95c82519ed6fd4f7236a41e0ae59ba4a8df76af24629efc:\s+downloading/);
      expect(processedLines[8]).toMatch(/^layer-sha256:e95942c4e21d00fe2aa7d8d59d745f53b8ee816795b7315f313b4d9625ec373c:\s+waiting/);
      expect(processedLines[9]).toMatch(/^layer-sha256:efe9738af0cb2184ee8f3fb3dcb130455385aa428a27d14e1e07a5587ff16e64:\s+downloading/);
      expect(processedLines[10]).toMatch(/^layer-sha256:f37aabde37b87d272286df45e6a3145b0884b72e07e657bf1a2a1e74a92c6172:\s+downloading/);
      expect(processedLines[11]).toMatch(/^\s*elapsed: (?:\d*\.)?\d+\s*s/);
    });
  });
  describe('pull with nerdctl', () => {
    it('culls by SHA', () => {
      const fname = path.join('./src/utils/processOutputInterpreters/__tests__/assets', 'pull03.txt');
      const data = fs.readFileSync(fname).toString();
      const lines = data.split(/(\r?\n)/);
      const culler = new ImageNonBuildOutputCuller();

      expect(lines.length).toBeGreaterThan(6);
      culler.addData(lines.slice(0, 16).join(''));
      let processedLines = culler.getProcessedData().split(/\r?\n/);

      expect(processedLines.length).toBe(2);
      expect(processedLines[0]).toMatch(/^docker.io\/camelpunch\/pr:latest:\s+resolving/);
      expect(processedLines[1]).toMatch(/^\s*elapsed: (?:\d*\.)?\d+\s*s/);

      culler.addData(lines.slice(16).join(''));
      processedLines = culler.getProcessedData().split(/\r?\n/);
      expect(processedLines.length).toBe(9);
      expect(processedLines[0]).toMatch(/^manifest-sha256:f6b002c6f990cdc3fa37d72758c07eac19474062616c14abf16bf3dbd8774387:\s+\w+/);
      expect(processedLines[1]).toMatch(/^config-sha256:f1c8c98faff0d97b3db8bffef6ea2ba46adacb931c7546a81eec4a25264fefc6:\s+\w+/);
      expect(processedLines[2]).toMatch(/^layer-sha256:37c312f1a2a16f5f3bb8ee3c1675c5a880d88455004bc0c6559cf492a3c036b4:\s+\w+/);
      expect(processedLines[3]).toMatch(/^layer-sha256:e110a4a1794126ef308a49f2d65785af2f25538f06700721aad8283b81fdfa58:\s+\w+/);
      expect(processedLines[4]).toMatch(/^layer-sha256:923daccf3632d196d3835182d8a2ab0dad87cad52facb11fb68867c68058a590:\s+\w+/);
      expect(processedLines[5]).toMatch(/^layer-sha256:cc10bd68fc4e1f492195886d2379cfba5ca38648908c05bd2a51bbeaf2d76fd4:\s+\w+/);
      expect(processedLines[6]).toMatch(/^layer-sha256:aa88609bf330d1483a52ae369ce88bdfa51aa264adf0814c2853d4f9860d5387:\s+\w+/);
      expect(processedLines[7]).toMatch(/^\s*docker.io\/camelpunch\/pr:latest:\s+resolved/);
      expect(processedLines[8]).toMatch(/^\s*elapsed: (?:\d*\.)?\d+\s*s/);
    });
  });
});
