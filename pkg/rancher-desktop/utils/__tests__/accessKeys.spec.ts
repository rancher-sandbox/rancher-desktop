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

import { removeParenthesizedAccessKey } from '../accessKeys';

describe('removeParenthesizedAccessKey', () => {
  it.each([
    ['削除(&D)', '削除'],
    ['&Delete', '&Delete'],
    ['Save (&&) Quit', 'Save (&&) Quit'],
  ])('turns %p into %p', (label, expected) => {
    expect(removeParenthesizedAccessKey(label)).toBe(expected);
  });
});
