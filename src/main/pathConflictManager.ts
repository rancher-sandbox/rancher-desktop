import path from 'path';
import fs from 'fs';
import timers from 'timers';

import * as window from '@/window';
import pathConflict from '@/utils/pathConflict';
import Logging from '@/utils/logging';
import paths from '@/utils/paths';

const console = Logging.background;
const DebounceInterval = 500; // msec

export default class PathConflictManager {
  protected pathConflicts: Record<string, Array<string>> = {};

  #requests: Record<string, ReturnType<typeof timers.setInterval>> = {};

  constructor() {
    this.pathConflicts = {};
    this.setupPathWatchersForShadowing().catch((err) => {
      console.log('Error in path file watchers:', err);
    });
  }

  reportConflicts(binaryName: string) {
    if (!(binaryName in this.pathConflicts)) {
      this.updateAndReportConflicts(binaryName);
    } else {
      window.send('k8s-integration-warnings', binaryName, this.pathConflicts[binaryName]);
    }
  }

  /**
   * Gathers all the conflicting files for the supplied binary and reports them
   * to the renderer.
   *
   * When called from the file-system watcher, always update the results.
   * This is called from the UI only if there's no cached data for the supplied binary.
   */
  protected async updateAndReportConflicts(binaryName: string) {
    let results: Array<string> = [];

    try {
      results = this.pathConflicts[binaryName] = await pathConflict(paths.integration, binaryName);
    } catch (err) {
      console.log(`Error gathering conflicts for file ${ binaryName }`, err);
      // And leave results as an empty array, to clear the current warnings
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
    const currentPathDirectories = currentPathAsString.split(path.delimiter)
      .filter(dir => path.resolve(dir) !== paths.integration);
    const namesOfInterest = ['docker', 'helm', 'kim', 'kubectl', 'nerdctl'];

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
          if (namesOfInterest.includes(filename)) {
            // Don't act on a file-system change right away -- a rename can trigger two identical events in quick succession
            // And if more than one directory changes due to a bulk operation, wait for the system to settle down

            if (!this.#requests[filename]?.refresh()) {
              this.#requests[filename] = setTimeout(() => {
                this.updateAndReportConflicts(filename);
                delete this.#requests[filename];
              }, DebounceInterval);
            }
          }
        });
      } catch (err) {
        console.log(`error in setupPathWatchersForShadowing:`, err);
      }
    }
  }
}
