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

import Latch from '../latch';

describe('Latch', () => {
  it('can be resolved', async() => {
    const latch = Latch();
    let resolved = false;
    const assertion = expect(latch).resolves.toBe(undefined);
    setTimeout(() => {
      expect(resolved).toBe(false);
      resolved = true;
      latch.resolve();
    }, 0);
    expect(resolved).toBe(false);
    await assertion;
    expect(resolved).toBe(true);
  }, 100);

  it('can be resolved with a value', async() => {
    const latch = Latch<number>();
    let resolved = false;
    const assertion = expect(latch).resolves.toBe(123);
    setTimeout(() => {
      expect(resolved).toBe(false);
      resolved = true;
      latch.resolve(123);
    }, 0);
    expect(resolved).toBe(false);
    await assertion;
    expect(resolved).toBe(true);
  }, 100);

  it('can be resolved without any handlers', async() => {
    // If the latch resolves and it internally rejects a promise, it should not
    // cause an UnhandledPromiseRejectionWarning even if we never await the latch.
    Latch().resolve();

    // Wait a tick to allow any unhandled microtask rejections to surface.
    await new Promise(resolve => setTimeout(resolve, 10));
  }, 100);

  it('accepts invalid then callbacks', async() => {
    const latch = Latch();
    // @ts-expect-error - then callback is not a function
    const chained = latch.then(123);
    const assertion = expect(chained).resolves.toBe(undefined);
    setTimeout(() => {
      latch.resolve();
    }, 0);
    await assertion;
  }, 100);

  it('can chain then without a callback', async() => {
    const expected = 999;
    const latch = Latch<typeof expected>();
    const chained = latch.then();
    const assertion = expect(chained).resolves.toBe(expected);
    setTimeout(() => {
      latch.resolve(expected);
    }, 0);
    await assertion;
  }, 100);

  it('can be rejected', async() => {
    const error = new Error('test');
    const latch = Latch();
    let rejected = false;
    const assertion = expect(latch).rejects.toThrow(error);
    setTimeout(() => {
      expect(rejected).toBe(false);
      rejected = true;
      latch.reject(error);
    }, 0);
    expect(rejected).toBe(false);
    await assertion;
    expect(rejected).toBe(true);
  }, 100);

  it('can chain catch without a callback', async() => {
    const error = new Error('test');
    const latch = Latch();
    const chained = latch.catch();
    const assertion = expect(chained).rejects.toThrow(error);
    setTimeout(() => {
      latch.reject(error);
    }, 0);
    await assertion;
  }, 100);

  it('accepts invalid catch callbacks', async() => {
    const latch = Latch();
    // @ts-expect-error - catch callback is not a function
    const chained = latch.catch(123);
    const assertion = expect(chained).rejects.toThrow(new Error('test'));
    setTimeout(() => {
      latch.reject(new Error('test'));
    }, 0);
    await assertion;
  }, 100);

  it('can be reset', async() => {
    const latch = Latch();
    let resolved = false;
    const assertion1 = expect(latch).resolves.toBe(undefined);
    setTimeout(() => {
      expect(resolved).toBe(false);
      resolved = true;
      latch.resolve();
    }, 0);
    expect(resolved).toBe(false);
    await assertion1;
    expect(resolved).toBe(true);

    latch.reset();

    let rejected = false;
    const error = new Error('test');
    const assertion2 = expect(latch).rejects.toThrow(error);
    setTimeout(() => {
      expect(rejected).toBe(false);
      rejected = true;
      latch.reject(error);
    }, 0);
    expect(rejected).toBe(false);
    await assertion2;
    expect(rejected).toBe(true);
  }, 100);

  it('can be reset multiple times', async() => {
    const latch = Latch();
    let resolved = false;
    const assertion1 = expect(latch).resolves.toBe(undefined);
    setTimeout(() => {
      expect(resolved).toBe(false);
      resolved = true;
      latch.reset();
      latch.reset();
      latch.resolve();
    }, 0);
    expect(resolved).toBe(false);
    await assertion1;
    expect(resolved).toBe(true);
  }, 100);

  it('can reset while pending', async() => {
    const latch = Latch();
    let resolved = false;
    const assertion = expect(latch).resolves.toBe(undefined);
    setTimeout(() => {
      expect(resolved).toBe(false);
      latch.reset();
      resolved = true;
      latch.resolve();
    }, 0);
    expect(resolved).toBe(false);
    await assertion;
    expect(resolved).toBe(true);
  }, 100);

  it('runs finally callback', async() => {
    const latch = Latch();
    let finallyCalled = false;
    latch.finally(() => {
      finallyCalled = true;
    });
    const assertion = expect(latch).resolves.toBe(undefined);
    setTimeout(() => {
      expect(finallyCalled).toBe(false);
      latch.resolve();
    }, 0);
    expect(finallyCalled).toBe(false);
    await assertion;
    expect(finallyCalled).toBe(true);
  }, 100);

  it('can be resolved before being awaited', async() => {
    const expected = 42;
    const latch = Latch<typeof expected>();
    latch.resolve(expected);
    await expect(latch).resolves.toBe(expected);
  });
});
