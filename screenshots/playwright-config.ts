import childProcess from 'child_process';
import os from 'os';
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
  timeout:       5 * 60 * 1000 * timeScale,
  globalTimeout: 30 * 60 * 1000 * timeScale,
  workers:       1,
  reporter:      'list',
  use:           { colorScheme },
};

if (os.platform() === 'win32') {
  const mode = process.env.THEME === 'dark' ? '0' : '1';

  childProcess.execSync(`reg add HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize /v AppsUseLightTheme /t REG_DWORD /f /d ${ mode }`);
}

export default config;
