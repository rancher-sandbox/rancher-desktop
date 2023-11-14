/*
Copyright © 2022 SUSE LLC

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

import AsyncCallbackIterator from '../iterator';

describe('AsyncCallbackIterator', () => {
  test('can iterate items', async() => {
    const subject = new AsyncCallbackIterator<number>();
    const results: number[] = [];

    setTimeout(() => subject.emit(1), 100);
    setTimeout(() => subject.emit(2), 200);
    setTimeout(() => subject.end(), 300);

    for await (const val of subject) {
      results.push(val);
    }

    expect(results).toEqual([1, 2]);
  }, 1_000);

  test('can handle exceptions', async() => {
    const subject = new AsyncCallbackIterator<number>();

    setTimeout(() => subject.error('hello'), 100);

    await expect(async() => {
      for await (const val of subject) {
        fail(`Got unexpected value ${ val }`);
      }
    }).rejects.toEqual('hello');
  });
});
