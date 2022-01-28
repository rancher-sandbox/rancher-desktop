import timers from 'timers';

/**
 * class Latch is a simple extension on Promise that is resolved via calling a
 * method.
 */
export default class Latch extends Promise<void> {
  #resolve?: () => void;
  constructor() {
    super((resolve) => {
      // We can't set the property from within the callback in the superclass,
      // because our instance hasn't been constructed yet.  So we need to do it
      // in a setImmediate() callback.
      timers.setImmediate(() => {
        this.#resolve = resolve;
      });
    });
  }

  resolve() {
    if (this.#resolve) {
      this.#resolve();
    }
  }
}
