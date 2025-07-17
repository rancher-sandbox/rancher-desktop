/**
 * This file is preloaded into all Jest tests (see package.json,
 * `jest.setupFiles`) and is used to set up default plugins in Vue.
 */

import { config } from '@vue/test-utils';

config.global.mocks = {
  t: (key: string) => key,
};
