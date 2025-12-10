import * as path from 'path';

import { defineConfig } from '@playwright/test';

const ci = !!process.env.CI;
const outputDir = path.join(import.meta.dirname, '..', 'e2e', 'test-results');
const testDir = path.join(import.meta.dirname, '..', '..', 'e2e');
// The provisioned github runners are much slower overall than cirrus's, so allow 2 hours for a full e2e run
const timeScale = ci ? 4 : 1;

const config = defineConfig({
  testDir,
  outputDir,
  timeout:       10 * 60 * 1000 * timeScale,
  globalTimeout: 30 * 60 * 1000 * timeScale,
  workers:       1,
  reporter:      'list',
  retries:       ci ? 2 : 0,
  use:           {
    trace: {
      mode:        'on-all-retries',
      screenshots: true,
    },
  },
});

export default config;
