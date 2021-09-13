import path from 'path';
import fs from 'fs';
import os from 'os';
import timers from 'timers';

import Electron from 'electron';
import * as window from '@/window';
import shadowInfo from '@/utils/pathCheck';
import resources from '@/resources';

const DebounceInterval = 500; // msec

export default class PathConflictManager {
  protected pathConflicts: Record<string, Array<string>> = {};

  #requests: Record<string, ReturnType<typeof timers.setInterval>> = {};

  constructor() {
    this.pathConflicts = {};
    this.setupPathWatchersForShadowing().then().catch((err) => {
      console.log('Error in path file watchers:', err);
    });
  }

  /**
   * Gathers all the conflicting files for the supplied binary and reports them
   * to the renderer.
   *
   * Can be called either from the UI via an async request, or from the file-system watcher
   * When called from the file-system watcher `event` will be undefined. Since changes
   * in the actual results are monitored by the file-system watcher, when there's a
   * non-null event we can use existing results, if they're present.
   */
  async reportConflicts(binaryName: string, event?: Electron.IpcMainEvent) {
    let results: Array<string> = [];

    try {
      if (event && (binaryName in this.pathConflicts)) {
        results = this.pathConflicts[binaryName];
      } else {
        results = this.pathConflicts[binaryName] = await shadowInfo('/usr/local/bin', binaryName);
      }
    } catch (err) {
      console.log(`Error gathering conflicts for file ${ binaryName }`, err);
    }
    window.send('k8s-integration-warnings', binaryName, results);
  }

  /**
   * Creates file-system watchers on each directory in the path.
   * Then when it notices a change in one of those directories involving a file we care about,
   * it redoes a scan looking for all conflicts and reports them to the UI.
   */
  private async setupPathWatchersForShadowing(): Promise<void> {
    const currentPathAsString = process.env.PATH;

    if (!currentPathAsString) {
      return;
    }
    const currentPathDirectories = currentPathAsString.split(path.delimiter);
    const namesOfInterest = ['helm', 'kim', 'kubectl'];

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
            // Don't act on a file-system change right away -- a rename can trigger two identical events in quick succession
            // And if more than one directory changes due to a bulk operation, wait for the system to settle down

            if (this.#requests[filename]) {
              clearTimeout(this.#requests[filename]);
            }
            this.#requests[filename] = setTimeout(() => {
              this.reportConflicts(filename);
              delete this.#requests[filename];
            }, DebounceInterval);
          }
        });
      } catch (err) {
        console.log(`error in setupPathWatchersForShadowing:`, err);
      }
    }
  }
}
