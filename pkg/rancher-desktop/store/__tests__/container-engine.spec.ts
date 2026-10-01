/** @jest-environment node */

import { jest } from '@jest/globals';

import { actions, state as createState, STANDALONE_CONTAINERS_GROUP } from '@pkg/store/container-engine';

describe('container store', () => {
  /** Run fetchContainers against one API container and return the UI container it produced. */
  async function fetchOne(overrides: Record<string, unknown>) {
    const listContainers = jest.fn<() => Promise<unknown>>().mockResolvedValue([{
      Id:       'container-id',
      Names:    ['web'],
      Image:    'nginx',
      ImageID:  'sha256:image-id',
      Status:   'Up 5 minutes',
      State:    'running',
      Started:  '2024-01-01T00:00:00Z',
      Labels:   {},
      Ports:    {},
      ...overrides,
    }]);
    const commit = jest.fn<(mutation: string, payload: any) => void>();
    const currentState = createState();

    currentState.client = { docker: { listContainers } } as any;

    await (actions.fetchContainers as any)({
      commit,
      getters: { supportsNamespaces: false },
      state:   currentState,
    });

    const containersCommit = commit.mock.calls.find(([mutation]) => mutation === 'SET_CONTAINERS');

    return containersCommit?.[1]['container-id'];
  }

  it.each([
    ['/web', 'web'],
    ['web', 'web'],
  ])('normalizes the container name %s to %s for the UI', async(apiName, expectedName) => {
    const container = await fetchOne({ Names: [apiName] });

    expect(container.containerName).toBe(expectedName);
  });

  it.each([
    ['no grouping labels', {}, STANDALONE_CONTAINERS_GROUP],
    ['a compose project label', { 'com.docker.compose.project': 'shop' }, 'shop'],
    ['kubernetes pod labels', {
      'io.kubernetes.pod.name':      'web-0',
      'io.kubernetes.pod.namespace': 'default',
    }, 'default/web-0'],
  ])('groups a container with %s', async(_, labels, expectedGroup) => {
    const container = await fetchOne({ Labels: labels });

    expect(container.projectGroup).toBe(expectedGroup);
  });

  it('keeps the standalone group key untranslated', () => {
    expect(STANDALONE_CONTAINERS_GROUP).toBe('Standalone Containers');
  });
});
