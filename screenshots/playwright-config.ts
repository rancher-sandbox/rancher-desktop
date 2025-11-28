import childProcess from 'child_process';
import os from 'os';
import * as path from 'path';

import { defineConfig } from '@playwright/test';

const ci = !!process.env.CI;
const timeScale = ci ? 2 : 1;

process.env.RD_MOCK_FOR_SCREENSHOTS = 'true';

const config = defineConfig({
  testDir:       path.join(import.meta.dirname, '..', 'screenshots'),
  outputDir:     path.join(import.meta.dirname, '..', 'e2e', 'reports'),
  timeout:       10 * 60 * 1000 * timeScale,
  globalTimeout: 30 * 60 * 1000 * timeScale,
  workers:       1,
  reporter:      'list',
  retries:       ci ? 2 : 0,
  use:           {
    colorScheme: process.env.THEME === 'dark' ? 'dark' : 'light',
    trace:       {
      mode:        'on-all-retries',
      screenshots: true,
    },
  },
});

if (os.platform() === 'darwin') {
  childProcess.execSync(`osascript -e 'tell app "System Events" to tell appearance preferences to set dark mode to ${ config.use?.colorScheme === 'dark' }'`);
}

if (os.platform() === 'win32') {
  const mode = config.use?.colorScheme === 'dark' ? '0' : '1';

  childProcess.execSync(`reg add HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize /v AppsUseLightTheme /t REG_DWORD /f /d ${ mode }`);
}

export default config;
