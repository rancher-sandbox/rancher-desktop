import childProcess from 'child_process';
import os from 'os';
import * as path from 'path';

import type { Config, PlaywrightTestOptions } from '@playwright/test';

const outputDir = path.join(import.meta.dirname, 'test-results');
const testDir = path.join(import.meta.dirname, '..', 'screenshots');
const timeScale = process.env.CI ? 2 : 1;
const colorScheme = (process.env.THEME || 'light') as PlaywrightTestOptions['colorScheme'];

process.env.RD_MOCK_FOR_SCREENSHOTS = 'true';

const config: Config<PlaywrightTestOptions> = {
  testDir,
  outputDir,
  timeout:       10 * 60 * 1000 * timeScale,
  globalTimeout: 30 * 60 * 1000 * timeScale,
  workers:       1,
  reporter:      'list',
  use:           { colorScheme },
};

if (os.platform() === 'darwin') {
  childProcess.execSync(`osascript -e 'tell app "System Events" to tell appearance preferences to set dark mode to ${ colorScheme === 'dark' }'`);
}

if (os.platform() === 'win32') {
  const mode = process.env.THEME === 'dark' ? '0' : '1';

  childProcess.execSync(`reg add HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize /v AppsUseLightTheme /t REG_DWORD /f /d ${ mode }`);
}

export default config;
