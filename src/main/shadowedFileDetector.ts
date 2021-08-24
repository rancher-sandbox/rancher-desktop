import path from 'path';
import fs from 'fs';
import os from 'os';
import timers from 'timers';

import Electron from 'electron';
import * as window from '@/window';
import shadowInfo from '@/utils/pathCheck';
import resources from '@/resources';

export class PathConflictManager {
  protected pathConflicts: Record<string, Array<string>> = {};

  constructor() {
    this.pathConflicts = {};
  }

  /**
   * Can be called either from the UI via an IPCRenderer event, or from the file-system watcher
   * When called from the file-system watcher `event` will be undefined.
   * @param resourceDir
   * @param binaryName
   * @param event
   */
  async getConflicts(resourceDir: string, binaryName: string, event?: Electron.IpcMainEvent) {
    try {
      let results: Array<string> = [];

      if (event && (binaryName in this.pathConflicts)) {
        results = this.pathConflicts[binaryName];
      } else if (os.platform() === 'win32') {
        results = this.pathConflicts[binaryName] = [];
      } else {
        results = this.pathConflicts[binaryName] = await shadowInfo(resourceDir, '/usr/local/bin', binaryName);
      }
      this.sendInfo(binaryName, results, event);
    } catch (err) {
      this.sendInfo(binaryName, [], event);
    }
  }

  private sendInfo(binaryName: string, results: Array<string>, event?: Electron.IpcMainEvent): void {
    if (event) {
      event.reply('k8s-integration-extra-info', binaryName, results);
    } else {
      window.send('k8s-integration-extra-info', binaryName, results);
    }
  }
}

const EchoInterval = 500; // msec
const requests: Record<string, ReturnType<typeof timers.setInterval>> = {};

/**
 * Should be called once -- creates file-system watchers on each directory in the path.
 * Then when it notices a change in one of those directories involving a file we care about,
 * it redoes a scan looking for all conflicts -- where a file with the same name lands earlier
 * in the path, and reports them to the UI.
 * @param pathConflictManager
 */
export async function setupPathWatchersForShadowing(pathConflictManager: PathConflictManager) {
  const currentPathAsString = process.env.PATH;

  if (!currentPathAsString) {
    return;
  }
  const currentPathDirectories = currentPathAsString.split(path.delimiter);
  const namesOfInterest = ['kubectl', 'kim', 'helm'];
  const resourceDir = path.dirname(resources.executable('kubectl'));

  for (const dirName of currentPathDirectories) {
    try {
      await fs.promises.access(dirName, fs.constants.R_OK);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.log(`error in setupPathWatchersForShadowing:`, err);
      }
      continue;
    }
    try {
      fs.watch(dirName, (eventType, filename) => {
        if (namesOfInterest.includes(filename) && dirName !== '/usr/local/bin') {
          // Don't act on a file-system change right away -- a rename can trigger two identical events
          // So wait 1/2 second to ensure only one fires
          // And if more than one directory changes all at once that involves a file we care
          // about, we wait EchoInterval msec at a time until the system settles down.

          if (requests[filename]) {
            clearTimeout(requests[filename]);
          }
          requests[filename] = setTimeout(() => {
            pathConflictManager.getConflicts(resourceDir, filename);
            delete requests[filename];
          }, EchoInterval);
        }
      });
    } catch (err) {
      console.log(`error in setupPathWatchersForShadowing:`, err);
    }
  }
}
