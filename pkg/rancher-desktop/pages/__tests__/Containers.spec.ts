import { jest } from '@jest/globals';

import mockModules from '@pkg/utils/testUtils/mockModules';
import { t } from '@pkg/utils/testUtils/translations';

const componentStub = { template: '<div />' };

mockModules({
  '@pkg/components/SortableTable': componentStub,
  '@pkg/entry/store':              {
    mapTypedGetters: jest.fn(() => ({})),
    mapTypedState:   jest.fn(() => ({})),
  },
  '@pkg/utils/ipcRenderer': {
    ipcRenderer: {
      on:             jest.fn(),
      send:           jest.fn(),
      invoke:         jest.fn(),
      removeListener: jest.fn(),
    },
  },
  '@rancher/components': {
    BadgeState: componentStub,
    Banner:     componentStub,
  },
  electron: { shell: { openExternal: jest.fn() } },
});

const { default: Containers } = await import('@pkg/pages/Containers.vue');
const methods = (Containers as any).methods;

describe('Containers methods', () => {
  function container(id: string, state: string, status: string): any {
    return {
      id,
      containerName: id,
      imageName:     'alpine',
      state,
      status,
      started:       undefined,
      labels:        {},
      ports:         {},
      projectGroup:  'Standalone Containers',
    };
  }

  const helpers = {
    isRunning: (candidate: any) => candidate.state === 'running' || candidate.status === 'Up',
    isStopped: (candidate: any) => candidate.state === 'created' || candidate.state === 'exited',
    t,
  };

  it('adds restart actions for running containers', () => {
    const running = container('running-container', 'running', 'Up');
    const stopped = container('stopped-container', 'exited', 'Exited');
    const runningRestart = methods.getContainerActions.call(helpers, running)
      .find((action: any) => action.action === 'restartContainer');
    const stoppedRestart = methods.getContainerActions.call(helpers, stopped)
      .find((action: any) => action.action === 'restartContainer');

    expect(runningRestart).toMatchObject({
      label:      'Restart',
      enabled:    true,
      bulkable:   true,
      bulkAction: 'restartContainer',
    });
    expect(stoppedRestart).toMatchObject({
      label:   'Restart',
      enabled: false,
    });
  });

  it('targets a single row unless a bulk selection is passed', () => {
    const running = container('running-container', 'running', 'Up');
    const stopped = container('stopped-container', 'exited', 'Exited');
    const bulkSelection = [running, stopped];

    expect(methods.containerCommandTarget(running)).toBe(running);
    expect(methods.containerCommandTarget(running, [])).toBe(running);
    expect(methods.containerCommandTarget(running, bulkSelection)).toBe(bulkSelection);
  });
});
