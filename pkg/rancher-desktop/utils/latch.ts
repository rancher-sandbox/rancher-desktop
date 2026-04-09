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
 * Creates a Latch that is an extension of a Promise that can be resolved via
 * calling a method on that Promise.
 */
export default function Latch<T = void>(): Latch<T> {
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
   * The state of the latch, which includes the promise that will be resolved
   * when the latch is settled and the promise that will be resolved when the
   * latch is reset.
   */
  const state = {
    promise: Promise.withResolvers<T>(),
    reset:   Promise.withResolvers<ResetState>(),
  };

  /** Wait for the latch to be settled, looping while it's reset. */
  async function waitForSettled() {
    while (true) {
      const { promise } = state.promise;
      const { promise: reset } = state.reset;
      const [p, r] = await Promise.allSettled([promise, reset]);

      if (r.status === 'fulfilled') {
        if (r.value === ResetState.SETTLED) {
          // The latch was resolved; return the resolved value.
          return p;
        }
        // If we get here, the latch was reset; try again.
      } else {
        // This should never reject.
        throw r.reason;
      }
    }
  }

  return {
    async then(onfulfilled, onrejected) {
      const result = await waitForSettled();

      if (result.status === 'fulfilled') {
        // If onfulfilled is not provided, it's implicitly identity, per
        // ECMA-262 27.2.2.1 step 1.d.i.1; MDN phrases it as:
        // > If it is not a function, it is internally replaced with an identity
        // > function ((x) => x) which simply passes the fulfillment value forward.
        // However, the TypeScript typings here don't have a proper fallback.
        if (typeof onfulfilled === 'function') {
          return onfulfilled(result.value);
        }
        return Promise.resolve(result.value) as any;
      } else {
        if (typeof onrejected === 'function') {
          return onrejected(result.reason);
        }
        return Promise.reject(result.reason);
      }
    },
    async catch(onrejected) {
      const result = await waitForSettled();

      if (result.status === 'rejected') {
        if (typeof onrejected === 'function') {
          return onrejected(result.reason);
        }
        return Promise.reject(result.reason);
      }
      // The latch was resolved; return the resolved value.
      return result.value;
    },
    async finally(onfinally) {
      const result = await waitForSettled();

      // The latch was settled; call the finally callback.
      if (typeof onfinally === 'function') {
        // If the return value is a promise, await on it so we can propagate
        // any rejections from it.
        await Promise.resolve(onfinally());
      }

      return result.status === 'fulfilled' ? result.value : Promise.reject(result.reason);
    },
    resolve(value: T) {
      state.promise.resolve(value);
      state.reset.resolve(ResetState.SETTLED);
    },
    reject(reason) {
      state.promise.reject(reason);
      state.reset.resolve(ResetState.SETTLED);
    },
    reset() {
      const { promise: oldPromise, reset: oldReset } = state;
      state.promise = Promise.withResolvers<T>();
      state.reset = Promise.withResolvers<ResetState>();
      // Settle the previous promises, so that we can check the new ones.
      oldReset.resolve(ResetState.RESET);
      // Prevent UnhandledPromiseRejectionWarning, because we don't know what
      // dummy value to resolve with.
      oldPromise.promise.catch(() => {});
      oldPromise.reject(new Error('Latch reset'));
    },
    [Symbol.toStringTag]: Promise.prototype[Symbol.toStringTag],
  };
}
