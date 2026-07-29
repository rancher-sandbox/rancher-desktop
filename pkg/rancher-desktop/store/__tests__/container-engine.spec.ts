/** @jest-environment node */

import { jest } from '@jest/globals';

import { actions, state as createState } from '@pkg/store/container-engine';

describe('container store', () => {
  it.each([
    ['/web', 'web'],
    ['web', 'web'],
  ])('normalizes the container name %s to %s for the UI', async(apiName, expectedName) => {
    const listContainers = jest.fn().mockResolvedValue([{
      Id:       'container-id',
      Names:    [apiName],
      Image:    'nginx',
      ImageID:  'sha256:image-id',
      Status:   'Up 5 minutes',
      State:    'running',
      Started:  '2024-01-01T00:00:00Z',
      Labels:   {},
      Ports:    {},
    }]);
    const commit = jest.fn();
    const currentState = createState();

    currentState.client = { docker: { listContainers } } as any;

    await (actions.fetchContainers as any)({
      commit,
      getters: { supportsNamespaces: false },
      state:   currentState,
    });

    const containersCommit = commit.mock.calls.find(([mutation]) => mutation === 'SET_CONTAINERS');

    expect(containersCommit?.[1]['container-id'].containerName).toBe(expectedName);
  });
});
