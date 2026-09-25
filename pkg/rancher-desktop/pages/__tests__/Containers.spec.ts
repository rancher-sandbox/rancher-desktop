import { jest } from '@jest/globals';

import mockModules from '@pkg/utils/testUtils/mockModules';
import { t } from '@pkg/utils/testUtils/translations';

const componentStub = { template: '<div />' };
const showMessageBox = jest.fn<(channel: string, options: any) => Promise<{ response: number }>>();

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
      invoke:         showMessageBox,
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

    expect(methods.containerCommandTarget(running)).toEqual([running]);
    expect(methods.containerCommandTarget(running, [])).toEqual([running]);
    expect(methods.containerCommandTarget(running, bulkSelection)).toBe(bulkSelection);
  });

  describe('deletion', () => {
    /** Build the row SortableTable would render for a single container. */
    function rowFor(item: any, context: any) {
      const self = {
        containers:             { [item.id]: item },
        supportsNamespaces:     true,
        getContainerActions:    () => [],
        getPortList:            () => [],
        containerCommandTarget: methods.containerCommandTarget,
        ...context,
      };

      return (Containers as any).computed.rows.call(self)[0];
    }

    beforeEach(() => {
      showMessageBox.mockReset();
    });

    it('names and counts the containers in the confirmation', async() => {
      showMessageBox.mockResolvedValue({ response: 0 });
      const containers = [container('one', 'exited', 'Exited'), container('two', 'exited', 'Exited')];

      await expect(methods.confirmDelete.call(helpers, containers)).resolves.toBe(true);
      expect(showMessageBox).toHaveBeenCalledWith('show-message-box', expect.objectContaining({
        message: 'Delete 2 containers?',
        detail:  'one\ntwo',
      }));
    });

    it('reports a cancelled confirmation, and defaults to Cancel', async() => {
      const cancelButton = 1;

      showMessageBox.mockResolvedValue({ response: cancelButton });
      await expect(methods.confirmDelete.call(helpers, [])).resolves.toBe(false);
      expect(showMessageBox).toHaveBeenCalledWith('show-message-box', expect.objectContaining({
        buttons:             ['&Delete', 'Cancel'],
        cancelId:            cancelButton,
        defaultId:           cancelButton,
        normalizeAccessKeys: true,
      }));
    });

    it('deletes the container once the user confirms', async() => {
      const execCommand = jest.fn();
      const doomed = container('doomed', 'exited', 'Exited');
      const row = rowFor(doomed, { execCommand, confirmDelete: () => Promise.resolve(true) });

      await row.deleteContainer();
      expect(execCommand).toHaveBeenCalledWith('rm', [doomed]);
    });

    it('confirms the whole bulk selection, and deletes none of it when cancelled', async() => {
      const execCommand = jest.fn();
      const confirmDelete = jest.fn<(targets: any[]) => Promise<boolean>>().mockResolvedValue(false);
      const doomed = [container('one', 'exited', 'Exited'), container('two', 'exited', 'Exited')];
      const row = rowFor(doomed[0], { execCommand, confirmDelete });

      await row.deleteContainer(doomed);
      expect(confirmDelete).toHaveBeenCalledWith(doomed);
      expect(execCommand).not.toHaveBeenCalled();
    });

    it('deletes the whole bulk selection once the user confirms', async() => {
      const execCommand = jest.fn();
      const doomed = [container('one', 'exited', 'Exited'), container('two', 'exited', 'Exited')];
      const row = rowFor(doomed[0], { execCommand, confirmDelete: () => Promise.resolve(true) });

      await row.deleteContainer(doomed);
      expect(execCommand).toHaveBeenCalledWith('rm', doomed);
    });

    it('leaves the container alone when the user cancels', async() => {
      const execCommand = jest.fn();
      const row = rowFor(container('spared', 'exited', 'Exited'),
        { execCommand, confirmDelete: () => Promise.resolve(false) });

      await row.deleteContainer();
      expect(execCommand).not.toHaveBeenCalled();
    });
  });
});

describe('Containers cell clicks', () => {
  function clickEvent(modifiers: Record<string, boolean> = {}): any {
    return {
      shiftKey:        false,
      ctrlKey:         false,
      metaKey:         false,
      preventDefault:  jest.fn(),
      stopPropagation: jest.fn(),
      ...modifiers,
    };
  }

  function clickThatAddsToSelection(): any {
    return clickEvent({ ctrlKey: true, metaKey: true });
  }

  const clickedContainer = { id: 'some-container' };
  const publishedHostPort = 8080;

  function cellClickHelpers() {
    return {
      isSelectionClick: methods.isSelectionClick,
      viewInfo:         jest.fn(),
      openUrl:          jest.fn(),
    };
  }

  it('opens the info page when the container name is clicked', () => {
    const helpers = cellClickHelpers();

    methods.onContainerNameClick.call(helpers, clickEvent(), clickedContainer);

    expect(helpers.viewInfo).toHaveBeenCalledWith(clickedContainer);
  });

  it('leaves a shift-click on the container name to the table', () => {
    const helpers = cellClickHelpers();
    const event = clickEvent({ shiftKey: true });

    methods.onContainerNameClick.call(helpers, event, clickedContainer);

    expect(helpers.viewInfo).not.toHaveBeenCalled();
    expect(event.stopPropagation).not.toHaveBeenCalled();
  });

  it('leaves a click that adds to the selection to the table', () => {
    const helpers = cellClickHelpers();
    const event = clickThatAddsToSelection();

    methods.onContainerNameClick.call(helpers, event, clickedContainer);

    expect(helpers.viewInfo).not.toHaveBeenCalled();
    expect(event.stopPropagation).not.toHaveBeenCalled();
  });

  it('opens the published port when a port is clicked', () => {
    const helpers = cellClickHelpers();

    methods.onPortClick.call(helpers, clickEvent(), publishedHostPort);

    expect(helpers.openUrl).toHaveBeenCalledWith(publishedHostPort);
  });

  it('does not open the published port when the click selects rows', () => {
    const helpers = cellClickHelpers();

    methods.onPortClick.call(helpers, clickEvent({ shiftKey: true }), publishedHostPort);
    methods.onPortClick.call(helpers, clickThatAddsToSelection(), publishedHostPort);

    expect(helpers.openUrl).not.toHaveBeenCalled();
  });
});
