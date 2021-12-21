import * as path from 'path';
import type { Config, PlaywrightTestOptions } from '@playwright/test';

const outputDir = path.join(__dirname, '..', 'e2e', 'test-results');
const testDir = path.join(__dirname, '..', '..', 'e2e');

const config: Config<PlaywrightTestOptions> = {
  testDir,
  outputDir,
  timeout:       process.env.CI ? 600_000 : 300_000,
  globalTimeout: 900_000,
  workers:       1,
  reporter:      'list',
};

export default config;
