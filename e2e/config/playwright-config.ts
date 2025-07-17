import * as path from 'path';

import type { Config, PlaywrightTestOptions } from '@playwright/test';

const outputDir = path.join(import.meta.dirname, '..', 'e2e', 'test-results');
const testDir = path.join(import.meta.dirname, '..', '..', 'e2e');
// The provisioned github runners are much slower overall than cirrus's, so allow 2 hours for a full e2e run
const timeScale = process.env.CI ? 4 : 1;

const config: Config<PlaywrightTestOptions> = {
  testDir,
  outputDir,
  timeout:       10 * 60 * 1000 * timeScale,
  globalTimeout: 30 * 60 * 1000 * timeScale,
  workers:       1,
  reporter:      'list',
};

export default config;
