// This is only here because I couldn't figure out how to mock fs.readFileSync
// for the config files only

import fs from 'fs';

export function readConfigFile(path: string): string {
  return fs.readFileSync(path, 'utf-8');
}
