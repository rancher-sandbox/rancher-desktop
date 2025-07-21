import { BackendProgress } from './backend';

import { Log } from '@pkg/utils/logging';

const ErrorDescription = Symbol('progressTracker.description');

export function getProgressErrorDescription(e: any) {
  return e[ErrorDescription] as string | undefined;
}

/**
 * ProgressTracker is used to track the progress of multiple parallel actions.
 * It invokes a callback that takes a progress object as input when one of those
 * actions comes to a close. An "action" is effectively a Promise with some
 * associated metadata.
 *
 * Additionally, a "numeric" progress object can be set on ProgressTracker.
 * This takes precedence over any other progress object that may correspond
 * to an action. This can be useful for things like summarizing the overall
 * progress of all actions configured on the ProgressTracker.
 */
export default class ProgressTracker {
  /**
   * @param notify The callback to invoke on progress change.
   */
  constructor(notify: (progress: BackendProgress) => void, log?: Log) {
    this.notify = notify;
    this.log = log;
  }

  /**
   * A function that will be called when there is any change in the
   * state of progress.
   */
  protected notify: (progress: BackendProgress) => void;

  /**
   * Optional logger to track state changes.   We will only emit debug output.
   */
  protected log?: Log;

  /**
   * A progress object that is preferred over progress objects that
   * correspond to actions when passing one to .notify. Can be thought
   * of as an action without any associated Promise and with infinitely
   * high priority.
   */
  protected numericProgress?: BackendProgress;

  /**
   * A list of pending actions. The currently running action with
   * the highest priority will be passed to this.notify.
   */
  protected actionProgress: { priority: number, id: number, progress: BackendProgress }[] = [];

  /**
   * Provides the ID of the next action.
   */
  protected nextActionID = 0;

  /**
   * Set the progress to a numeric value.  Numeric progress is always shown in
   * preference to other progress.  There may only be one active numeric
   * progress at a time.
   * @param description Descriptive text.
   * @param current The current numeric progress
   * @param max Maximum possible numeric prog
   */
  numeric(description: string, current: number, max: number) {
    if (current < max) {
      this.numericProgress = {
        current, max, description, transitionTime: new Date(),
      };
    } else {
      this.numericProgress = undefined;
    }
    this.update();
  }

  /**
   * Register an action.
   * @param description Descriptive text for the action, to be shown to the user.
   * @param priority Only the action with the largest priority will be shown among concurrent actions.
   * @returns A promise that will be resolved when the passed-in promise resolves.
   */
  action<T>(description: string, priority: number, promise: Promise<T>): Promise<T>;
  action<T>(description: string, priority: number, fn: () => Promise<T>): Promise<T>;
  action<T>(description: string, priority: number, v: Promise<T> | (() => Promise<T>)) {
    const id = this.nextActionID;

    this.nextActionID++;
    this.actionProgress.push({
      priority,
      id,
      progress: {
        current: 0, max: -1, description, transitionTime: new Date(),
      },
    });
    this.update();
    this.log?.debug(`Progress: started ${ description }`);

    const promise = (v instanceof Promise) ? v : v();

    return new Promise<T>((resolve, reject) => {
      promise.then((val) => {
        this.actionProgress = this.actionProgress.filter(p => p.id !== id);
        this.update();
        this.log?.debug(`Progress: finished ${ description }`);
        resolve(val);
      }).catch((ex) => {
        this.actionProgress = this.actionProgress.filter(p => p.id !== id);
        this.update();
        this.log?.debug(`Progress: errored ${ description }: ${ ex?.ErrorDescription ?? ex }`);
        if (!(ErrorDescription in ex)) {
          Object.defineProperty(
            ex,
            ErrorDescription,
            {
              enumerable: false,
              value:      description,
            });
        }
        reject(ex);
      });
    });
  }

  /**
   * Invoke this.notify with the highest-priority progress object.
   */
  protected update() {
    if (this.numericProgress) {
      this.notify(this.numericProgress);

      return;
    }
    if (this.actionProgress.length < 1) {
      // No action progress either; no active progress at all.
      this.notify({ current: 1, max: 1 });

      return;
    }

    const { progress } = this.actionProgress.reduce((a, b) => a.priority > b.priority ? a : b);

    this.notify(progress);
  }
}
