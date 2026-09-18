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
  '@rancher/components': { Banner: componentStub },
});

const { default: Volumes } = await import('@pkg/pages/Volumes.vue');

describe('Volumes methods', () => {
  beforeEach(() => {
    showMessageBox.mockReset();
  });

  function volume(name: string): any {
    return {
      Name:       name,
      Driver:     'local',
      Mountpoint: `/var/lib/docker/volumes/${ name }`,
      CreatedAt:  '',
    };
  }

  it('names and counts the volumes in the confirmation, and defaults to Cancel', async() => {
    const cancelButton = 1;

    showMessageBox.mockResolvedValue({ response: cancelButton });
    await expect((Volumes as any).methods.confirmDelete.call({ t }, [volume('one'), volume('two')]))
      .resolves.toBe(false);
    expect(showMessageBox).toHaveBeenCalledWith('show-message-box', expect.objectContaining({
      message:             'Delete 2 volumes?',
      detail:              'one\ntwo',
      buttons:             ['&Delete', 'Cancel'],
      cancelId:            cancelButton,
      defaultId:           cancelButton,
      normalizeAccessKeys: true,
    }));
  });

  describe('deletion', () => {
    /** Build the row SortableTable would render for a single volume. */
    function rowFor(item: any, context: any) {
      const self = {
        volumes: { [item.Name]: item },
        t,
        ...context,
      };

      return (Volumes as any).computed.rows.call(self)[0];
    }

    it('confirms the whole bulk selection, and deletes none of it when cancelled', async() => {
      const execCommand = jest.fn();
      const confirmDelete = jest.fn<(targets: any[]) => Promise<boolean>>().mockResolvedValue(false);
      const doomed = [volume('one'), volume('two')];
      const row = rowFor(doomed[0], { execCommand, confirmDelete });

      await row.deleteVolume(doomed);
      expect(confirmDelete).toHaveBeenCalledWith(doomed);
      expect(execCommand).not.toHaveBeenCalled();
    });

    it('deletes the whole bulk selection once the user confirms', async() => {
      const execCommand = jest.fn();
      const doomed = [volume('one'), volume('two')];
      const row = rowFor(doomed[0], { execCommand, confirmDelete: () => Promise.resolve(true) });

      await row.deleteVolume(doomed);
      expect(execCommand).toHaveBeenCalledWith(['volume', 'rm'], doomed);
    });

    it('targets the row when the bulk selection is empty', async() => {
      const execCommand = jest.fn();
      const spared = volume('spared');
      const row = rowFor(spared, { execCommand, confirmDelete: () => Promise.resolve(true) });

      await row.deleteVolume([]);
      expect(execCommand).toHaveBeenCalledWith(['volume', 'rm'], [spared]);
    });
  });
});
