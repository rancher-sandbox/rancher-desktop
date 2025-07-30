import { jest } from '@jest/globals';
import { shallowMount } from '@vue/test-utils';

import mockModules from '@pkg/utils/testUtils/mockModules';

interface Progress {
  current:         number;
  max:             number;
  description?:    string;
  transitionTime?: Date;
}

function wrap(props: Record<string, any>) {
  return shallowMount(BackendProgress, { propsData: props });
}

const progress: Progress = { current: 0, max: 0 };
let callback: (event: Event | undefined, progress: Progress) => void = () => {};

mockModules({
  '@pkg/utils/ipcRenderer': {
    ipcRenderer: {
      on(name: string, cb: typeof callback) {
        expect(name).toEqual('k8s-progress');
        callback = cb;
      },
      invoke(name: string) {
        expect(name).toEqual('k8s-progress');
        return Promise.resolve(progress);
      },
    },
  },
});

const { default: BackendProgress } = await import('../BackendProgress.vue');

describe('BackendProgress', () => {
  beforeAll(() => {
    jest.useFakeTimers();
  });
  describe('progress', () => {
    describe('elapsed with max', () => {
      const testCases: [number, number, string][] = [
        [0, 100, '100 left'],
        [512, 1_024, '0.5K left'],
        [513, 1_024, '511 left'],
        [32_768, 65_536, '32K left'],
        [158_334_976, 681_574_400, '499M left'],
        [0, 681_574_400, '0.6G left'], // 650 MiB
        [681_574_400, 25_025_314_816, '23G left'],
        [25_025_314_816, 2_199_023_255_552, '2T left'],
        [0, 4_503_599_627_370_496, '4096T left'], // Past the scale
      ];
      for (const [current, max, expected] of testCases) {
        it(`should show ${ current }/${ max } as ${ expected }`, async() => {
          const wrapper = wrap({});

          Object.assign(progress, { current, max, transitionTime: new Date() });
          callback?.(undefined, progress);
          jest.advanceTimersByTime(1_000); // We delay rendering by half a second
          await wrapper.vm.$nextTick(); // Force Vue to update
          expect(wrapper.get('.duration').text()).toEqual(expected);
        });
      }
    });
    describe('elapsed duration', () => {
      const testCases: [number, string][] = [
        [1, '1s'],
        [59, '59s'],
        [60, '1m'],
        [60 * 60 - 1, '59m59s'],
        [60 * 60, '1h'],
        [2 * 60 * 60 + 42, '2h42s'], // Skip zero in the middle
        [24 * 60 * 60 - 1, '23h59m59s'],
        [24 * 60 * 60, '1d'],
        [30 * 24 * 60 * 60, '30d'], // Don't have units past days
        [366 * 24 * 60 * 60, '366d'],
      ];
      for (const [duration, expected] of testCases) {
        it(`should show ${ duration } as ${ expected }`, async() => {
          const wrapper = wrap({});

          // We need transitionTime to be non-zero; so we start at time=1s, and
          // mock Date.now() to be duration + 1 second.
          Object.assign(progress, { max: -1, transitionTime: 1 });
          jest.spyOn(Date, 'now').mockReturnValue((duration + 1) * 1_000);
          callback?.(undefined, progress);
          jest.advanceTimersByTime(1_000); // We delay rendering by half a second
          await wrapper.vm.$nextTick(); // Force Vue to update
          expect(wrapper.get('.duration').text()).toEqual(expected);
        });
      }
    });
  });
});
