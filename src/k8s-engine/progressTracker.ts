import * as K8s from './k8s';

/**
 * ProgressTracker is used to track progress of multiple parallel actions.
 */
export default class ProgressTracker {
  /**
   * @param notify The callback to invoke on progress change.
   */
  constructor(notify: (progress: K8s.KubernetesProgress) => void) {
    this.notify = notify;
  }

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
        current, max, description, transitionTime: new Date()
      };
    } else {
      this.numericProgress = undefined;
    }
    this.update();
  }

  /**
   * Run a given action.  The currently running action with the highest priority
   * will be displayed as the progress.
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
      }
    });
    this.update();

    const promise = (v instanceof Promise) ? v : v();

    return new Promise<T>((resolve, reject) => {
      promise.then((val) => {
        this.actionProgress = this.actionProgress.filter(p => p.id !== id);
        this.update();
        resolve(val);
      }).catch((ex) => {
        this.actionProgress = this.actionProgress.filter(p => p.id !== id);
        this.update();
        reject(ex);
      });
    });
  }

  protected notify: (progress: K8s.KubernetesProgress) => void;

  /**
   * The last set numeric progress.
   */
  protected numericProgress?: K8s.KubernetesProgress;

  /**
   * A list of progress from pending actions.
   */
  protected actionProgress: {priority: number, id: number, progress: K8s.KubernetesProgress}[] = [];

  /**
   * Unique identifier for the next action.
   */
  protected nextActionID = 0;

  /**
   * Update the display of the progress, depending on the current state.
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
