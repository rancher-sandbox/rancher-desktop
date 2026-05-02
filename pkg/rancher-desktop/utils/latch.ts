/*
Copyright © 2026 SUSE LLC

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

/**
 * Interface Latch is a simple extension on Promise that is resolved via calling
 * a method.  It is essentially a simplified barrier.
 *
 * @see https://en.wikipedia.org/wiki/Barrier_(computer_science)
 */
interface Latch<T> extends Promise<T> {
  /** Calling the resolve() method resolves the Latch. */
  resolve(value: T): void;
  /** Calling the reject() method rejects the Latch. */
  reject(reason: any): void;
  /** Calling the reset() method resets the Latch to an unresolved state. */
  reset(): void;
}

/**
 * ResetState is the enum value of `state.reset` that indicates whether the
 * latch was settled or reset.  This is used to determine whether we should
 * return the result of the latch or wait for it to be settled again.
 */
enum ResetState {
  /** The latch was resolved or rejected. */
  SETTLED,
  /** The latch was reset. */
  RESET,
}

/**
 * Creates a Latch that is an extension of a Promise that can be resolved via
 * calling a method on that Promise.
 */
export default function Latch<T = void>(): Latch<T> {
  /**
   * The state of the latch, which includes the promise that will be resolved
   * when the latch is settled and the promise that will be resolved when the
   * latch is reset.
   */
  const state = {
    promise: Promise.withResolvers<T>(),
    reset:   Promise.withResolvers<ResetState>(),
  };

  /** Wait for the latch to be settled, looping while it's reset. */
  async function waitForSettled(): Promise<T> {
    while (true) {
      // Capture the promises, so if somebody resolves, then resets, we still
      // return the result of the first resolution.
      const { reset: { promise: reset }, promise: { promise: p } } = state;

      if (await reset === ResetState.SETTLED) {
        // The latch was settled; return the result.
        return p;
      }
      // The latch was reset; loop and wait again with new state.
    }
  }

  return Object.create((Promise.prototype as Latch<T>), {
    then: {
      value(onfulfilled?: ((value: T) => any) | null, onrejected?: ((reason: any) => any) | null) {
        return waitForSettled().then(onfulfilled, onrejected);
      },
    },
    catch: {
      value(onrejected?: ((reason: any) => any) | null) {
        return waitForSettled().catch(onrejected);
      },
    },
    finally: {
      value(onfinally?: (() => any) | null) {
        return waitForSettled().finally(onfinally);
      },
    },
    resolve: {
      value(value: T) {
        state.promise.resolve(value);
        state.reset.resolve(ResetState.SETTLED);
      },
    },
    reject: {
      value(reason: any) {
        state.promise.reject(reason);
        state.reset.resolve(ResetState.SETTLED);
      },
    },
    reset: {
      value() {
        const { reset: oldReset, promise: oldPromise } = state;
        state.promise = Promise.withResolvers<T>();
        state.reset = Promise.withResolvers<ResetState>();
        // Resolve the reset state, so `waitForSettled` will loop.
        oldReset.resolve(ResetState.RESET);
        // Attach a catch to the old promise to avoid unhandled rejections if
        // it was rejected.
        oldPromise.promise.catch(() => { /* ignore */ });
      },
    },
  });
}
