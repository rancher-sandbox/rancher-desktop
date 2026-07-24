import { jest } from '@jest/globals';
import { mount } from '@vue/test-utils';
import FloatingVue from 'floating-vue';

import type { UpdateState } from '@pkg/main/update';
import mockModules from '@pkg/utils/testUtils/mockModules';
import { t as tFn } from '@pkg/utils/testUtils/translations';

mockModules({
  '@pkg/utils/ipcRenderer': {
    ipcRenderer: {
      on:   jest.fn(),
      send: jest.fn(),
    },
  },
  electron: undefined,
});

const { default: UpdateStatus } = await import('../UpdateStatus.vue');

function wrap(props: typeof UpdateStatus['$props']) {
  return mount(UpdateStatus, {
    props,
    global: {
      mocks:   { t: tFn },
      stubs:   { T: { template: '<span> {{ k }} </span>' } },
    },
    plugins: [FloatingVue],
  });
}

describe('UpdateStatus.vue', () => {
  describe('update visibility', () => {
    it('shows updates when available', () => {
      const wrapper = wrap({
        enabled:     true,
        updateState: { available: true, downloaded: true },
      });

      expect(wrapper.findComponent({ ref: 'updateInfo' }).exists()).toBeTruthy();
    });

    it('hides updates when disabled', () => {
      const wrapper = wrap({
        enabled:     false,
        updateState: { available: true, downloaded: true } as UpdateState,
      });

      expect(wrapper.findComponent({ ref: 'updateInfo' }).exists()).toBeFalsy();
    });

    it('hides when no updates are available', () => {
      const wrapper = wrap({
        enabled:     true,
        updateState: { available: false, downloaded: false } as UpdateState,
      });

      expect(wrapper.findComponent({ ref: 'updateInfo' }).exists()).toBeFalsy();
    });
  });

  describe('update status', () => {
    it('reports a download that failed', () => {
      const wrapper = wrap({
        enabled:     true,
        updateState: {
          available: true, downloaded: false, error: new Error('hello'), info: { version: 'v1.2.3' },
        } as UpdateState,
      });

      expect(wrapper.get({ ref: 'updateStatus' }).text())
        .toEqual('The download of version v1.2.3 failed.');
      expect(wrapper.element.querySelector('.update-notification'))
        .toBeFalsy();
      expect(wrapper.findComponent({ ref: 'applyButton' }).exists()).toBeFalsy();
    });

    it('still offers to install an update that was downloaded before an error', () => {
      const wrapper = wrap({
        enabled:     true,
        updateState: {
          available: true, downloaded: true, error: new Error('hello'), info: { version: 'v1.2.3' },
        } as UpdateState,
      });

      const statusDiv = wrapper.get({ ref: 'updateStatus' });

      expect(statusDiv.find('p').text())
        .toEqual('An update to version v1.2.3 is available.');
      expect(statusDiv.find('.update-notification').text())
        .toEqual('Restart the application to apply the update.');
      expect(wrapper.get({ ref: 'applyButton' }).attributes()).not.toHaveProperty('disabled');
      expect(wrapper.findComponent({ ref: 'retryButton' }).exists()).toBeFalsy();
    });

    it('offers to retry a download that failed', async() => {
      const failed = {
        available: true, downloaded: false, error: new Error('hello'), info: { version: 'v1.2.3' },
      } as UpdateState;
      const wrapper = wrap({ enabled: true, updateState: failed });

      await wrapper.get({ ref: 'retryButton' }).trigger('click');

      expect(wrapper.emitted('retry')).toHaveLength(1);
      expect(wrapper.get({ ref: 'retryButton' }).attributes()).toHaveProperty('disabled');
      expect(wrapper.get({ ref: 'retryButton' }).text()).toEqual('Retrying...');

      // The retry failed too, so the user has to be able to try once more.
      await wrapper.setProps({ updateState: { ...failed, error: new Error('again') } });

      expect(wrapper.get({ ref: 'retryButton' }).attributes()).not.toHaveProperty('disabled');
      expect(wrapper.get({ ref: 'retryButton' }).text()).toEqual('Retry');
    });

    it('lets the user try again when applying an update fails', async() => {
      const ready = {
        available: true, downloaded: true, info: { version: 'v1.2.3' },
      } as UpdateState;
      const wrapper = wrap({ enabled: true, updateState: ready });

      await wrapper.get({ ref: 'applyButton' }).trigger('click');

      expect(wrapper.get({ ref: 'applyButton' }).attributes()).toHaveProperty('disabled');

      // The install failed, so the button has to come back; the update is still
      // on disk and a restart is still the way to apply it.
      await wrapper.setProps({ updateState: { ...ready, error: new Error('install failed') } });

      expect(wrapper.get({ ref: 'applyButton' }).attributes()).not.toHaveProperty('disabled');
    });

    it('offers no retry when there is no error', () => {
      const wrapper = wrap({
        enabled:     true,
        updateState: {
          available: true, downloaded: false, info: { version: 'v1.2.3' },
        } as UpdateState,
      });

      expect(wrapper.findComponent({ ref: 'retryButton' }).exists()).toBeFalsy();
    });

    it('shows when an update is available', () => {
      const wrapper = wrap({
        enabled:     true,
        updateState: {
          available: true, downloaded: true, info: { version: 'v1.2.3' },
        } as UpdateState,
      });

      const statusDiv = wrapper.get({ ref: 'updateStatus' });

      expect(statusDiv.find('p').text())
        .toEqual('An update to version v1.2.3 is available.');
      expect(statusDiv.find('.update-notification').text())
        .toEqual('Restart the application to apply the update.');
      expect(wrapper.get({ ref: 'applyButton' }).attributes()).not.toHaveProperty('disabled');
    });

    it('does not allow applying again', async() => {
      const wrapper = wrap({
        enabled:     true,
        updateState: {
          available: true, downloaded: true, info: { version: 'v1.2.3' },
        } as UpdateState,
      });

      await wrapper.setData({ applying: true });
      expect(wrapper.get({ ref: 'applyButton' }).attributes()).toHaveProperty('disabled');
    });

    it('shows download progress', () => {
      const wrapper = wrap({
        enabled:     true,
        updateState: {
          configured: true,
          available:  true,
          downloaded: false,
          info:       {
            version:                    'v1.2.3',
            files:                      [],
            path:                       '',
            sha512:                     '',
            releaseDate:                '',
            nextUpdateTime:             12345,
            unsupportedUpdateAvailable: false,
          },
          progress: {
            percent:        12.34,
            bytesPerSecond: 1234567,
            total:          0,
            delta:          0,
            transferred:    0,
          },
        } as UpdateState,
        locale: 'en',
      });

      expect(wrapper.get({ ref: 'updateStatus' }).text())
        .toMatch(/^An update to version v1\.2\.3 is available; downloading... \(12%, 1\.2MB\/s(?:ec\.?)?\)$/);
      expect(wrapper.find({ ref: 'applyButton' }).exists()).toBeFalsy();
    });
  });

  describe('release notes', () => {
    it('should not be displayed if there are none', () => {
      const wrapper = wrap({ enabled: true, updateState: { info: { version: 'v1.2.3' } } as UpdateState });

      expect(wrapper.find({ ref: 'releaseNotes' }).exists()).toBeFalsy();
    });

    it('should render plain text', () => {
      const wrapper = wrap({
        enabled:     true,
        updateState: {
          available: true,
          info:      { version: 'v1.2.3', releaseNotes: 'hello' },
        } as UpdateState,
      });

      expect(wrapper.get({ ref: 'releaseNotes' }).text())
        .toEqual('hello');
    });

    it('should render markdown', () => {
      const wrapper = wrap({
        enabled:     true,
        updateState: {
          available: true,
          info:      { version: 'v1.2.3', releaseNotes: '**hello**' },
        } as UpdateState,
      });

      expect(wrapper.get({ ref: 'releaseNotes' }).html())
        .toContain('<strong>hello</strong>');
    });

    it('should not support scripting', () => {
      const wrapper = wrap({
        enabled:     true,
        updateState: {
          available: true,
          info:      {
            version:      'v1.2.3',
            releaseNotes: 'hello<script>alert(1)</script><img onload="alert(2)">',
          },
        } as UpdateState,
      });

      expect(wrapper.get({ ref: 'releaseNotes' }).html())
        .not.toContain('alert');
    });
  });
});
