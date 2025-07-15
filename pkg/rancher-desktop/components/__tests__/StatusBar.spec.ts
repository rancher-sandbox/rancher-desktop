import { shallowMount, VueWrapper } from '@vue/test-utils';

import StatusBar from '@pkg/components/StatusBar.vue';
import StatusBarItem from '@pkg/components/StatusBarItem.vue';

describe('StatusBar.vue', () => {
  let wrapper: VueWrapper<any>;

  beforeEach(() => {
    wrapper = shallowMount(StatusBar, {
      computed: {
        ...StatusBar.computed,
        getPreferences: jest.fn().mockReturnValue({
          kubernetes:      { version: '1.27.7', enabled: true },
          containerEngine: { name: 'containerd' },
        }),
      },
      mocks: { t: jest.fn() },
    });
  });

  it('contains four items', () => {
    expect(wrapper.findAllComponents(StatusBarItem).length).toBe(4);
  });

  it('should contain Rancher Desktop version item', () => {
    const props = wrapper.getComponent({ref: "version" }).props();

    expect(props.data).toBeFalsy();
    expect(props.icon).toBeTruthy();
    expect(props.subComponent).toBe('Version');
  });

  it('should contain network status item', () => {
    const props = wrapper.getComponent({ref: "network"}).props();

    expect(props.data).toBeFalsy();
    expect(props.icon).toBeTruthy();
    expect(props.subComponent).toBe('NetworkStatus');
  });

  it('should contain kubernetes version item', () => {
    const props = wrapper.getComponent({ref: "kubernetesVersion"}).props();

    expect(props.data.label.bar).toBe('product.kubernetesVersion');
    expect(props.data.value).toBe('1.27.7');
    expect(props.icon).toBeTruthy();
    expect(props.subComponent).toBeFalsy();
  });

  it('should contain container engine item', () => {
    const props = wrapper.getComponent({ref: "containerEngine"}).props();

    expect(props.data.label.bar).toBe('product.containerEngine.abbreviation');
    expect(props.data.value).toBe('containerd');
    expect(props.icon).toBeTruthy();
    expect(props.subComponent).toBeFalsy();
  });
});
