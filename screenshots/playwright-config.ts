import * as path from 'path';

import type { Config, PlaywrightTestOptions } from '@playwright/test';

const outputDir = path.join(__dirname, 'test-results');
const testDir = path.join(__dirname, '..', 'screenshots');
const timeScale = process.env.CI ? 2 : 1;
const colorScheme = (process.env.THEME || 'light') as PlaywrightTestOptions['colorScheme'];

process.env.MOCK_FOR_SCREENSHOTS = 'true';

const config: Config<PlaywrightTestOptions> = {
  testDir,
  outputDir,
  timeout:       300_000 * timeScale,
  globalTimeout: 900_000 * timeScale,
  workers:       1,
  reporter:      'list',
  use:           { colorScheme },
};

export default config;
