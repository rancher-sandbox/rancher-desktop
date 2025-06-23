import { mount } from '@vue/test-utils';
import FloatingVue from 'floating-vue';

import UpdateStatus from '../UpdateStatus.vue';

import { UpdateState } from '@pkg/main/update';

jest.mock('@pkg/utils/ipcRenderer', () => {
  return {
    ipcRenderer: {
      on:   jest.fn(),
      send: jest.fn(),
    },
  };
});

function wrap(props: typeof UpdateStatus['$props']) {
  return mount(UpdateStatus, {
    props,
    global: {
      mocks:   { t: jest.fn() },
      stubs:   {
        T: { template: '<span> {{ k }} </span>' },
        RdCheckbox: { template: '<input type="checkbox">' },
        Version: { template: '<span />'},
      },
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
    it('displays error correctly', () => {
      const wrapper = wrap({
        enabled:     true,
        updateState: {
          available: true, error: new Error('hello'), downloaded: true,
        } as UpdateState,
      });

      expect(wrapper.get({ ref: 'updateStatus' }).text())
        .toEqual('There was an error checking for updates.');
      expect(wrapper.element.querySelector('.update-notification'))
        .toBeFalsy();
    });

    it('hides when there is nothing to display', () => {
      const wrapper = wrap({
        enabled:     true,
        updateState: { available: true } as UpdateState,
      });

      expect(wrapper.get({ ref: 'updateStatus' }).text())
        .toEqual('');
    });

    it('shows when an update is available', () => {
      const wrapper = wrap({
        enabled:     true,
        updateState: {
          available: true, downloaded: true, info: { version: 'v1.2.3' },
        } as UpdateState,
      });

      expect(wrapper.get({ ref: 'updateStatus' }).text().replace(/\s+/g, ' '))
        .toEqual('An update to version v1.2.3 is available. Restart the application to apply the update.');

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
