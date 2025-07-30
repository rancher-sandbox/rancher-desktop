/*
Copyright © 2023 SUSE LLC

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

import Latch from './latch';

const doneSentinel: unique symbol = Symbol('iterator complete');

/**
 * AsyncCallbackIterator is a utility class that can be used to convert a
 * callback-based API to an async iterator.
 *
 * Usage:
 *   const foo = new AsyncCallbackIterator<Number>;
 *   foo.emit(1);
 *   foo.emit(2);
 *   foo.end();
 *   // elsewhere...
 *   for await (const n of foo) { ... }
 * It's also possible to call .error() to indicate an exception.
 */
export default class AsyncCallbackIterator<T> implements AsyncIterableIterator<T> {
  #next:    Promise<T | typeof doneSentinel>;
  #resolve: (value: T | PromiseLike<T> | typeof doneSentinel) => void;
  #reject:  (reason?: any) => void;
  #done = false;

  // #pending is used to provide backpressure; this will be resolved when we are
  // ready to emit the next item.
  #pending = Latch();

  constructor() {
    this.#resolve = undefined as any;
    this.#reject = undefined as any;
    this.#next = new Promise<T | typeof doneSentinel>((resolve, reject) => {
      this.#resolve = resolve;
      this.#reject = reject;
    });
    this.#pending.resolve();
  }

  /**
   * Emit an item to the iterator.
   * @param item The item to emit.
   */
  async emit(item: T) {
    if (this.#done) {
      throw new Error('Emitting result when end() has been called');
    }
    await this.#pending;
    this.#pending = Latch();
    if (!this.#done) {
      this.#resolve(item);
    }
  }

  /**
   * Signal an error to the iterator.
   * @param reason The error to emit.
   */
  async error(reason?: any) {
    if (this.#done) {
      throw new Error('Emitting result when end() has been called');
    }
    await this.#pending;
    this.#pending = Latch();
    if (!this.#done) {
      this.#reject(reason);
      this.#done = true;
    }
  }

  /**
   * Notify the iterator that the enumeration has completed.
   */
  end() {
    this.#resolve(doneSentinel);
  }

  [Symbol.asyncIterator]() {
    return this;
  }

  /**
   * Implement the JavaScript iterator protocol by returning the next result.
   */
  async next(): Promise<IteratorResult<T, undefined>> {
    if (this.#done) {
      return { done: true, value: undefined };
    }

    const result = await this.#next;

    if (result === doneSentinel) {
      this.#done = true;
      this.#pending.resolve();

      return { done: true, value: undefined };
    }

    this.#next = new Promise<T | typeof doneSentinel>((resolve, reject) => {
      this.#resolve = resolve;
      this.#reject = reject;
    });
    this.#pending.resolve();

    return { value: result };
  }
}
