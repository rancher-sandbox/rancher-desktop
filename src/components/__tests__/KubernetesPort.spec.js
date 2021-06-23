import { mount } from '@vue/test-utils';
import KubernetesPort from '../KubernetesPort.vue';

const deepmerge = require('deepmerge');

function createWrappedPage(props) {
  return mount(KubernetesPort, { propsData: props });
}

const baseProps = { port: 6443 };

describe('SystemPreferences.vue', () => {
  it('accepts valid data', () => {
    const wrapper = createWrappedPage(baseProps);

    expect(wrapper.props().port).toBe(6443);
  });

  it('sets correct defaults and is enabled', () => {
    const minimalProps = deepmerge(baseProps, {});

    delete minimalProps.port;
    const wrapper = createWrappedPage(minimalProps);

    expect(wrapper.props().port).toBe(6443);
  });

  xit('emits events for the port wrapper', async() => {
    const wrapper = createWrappedPage(baseProps);

    const divPort = wrapper.find('div#portWrapper');

    await divPort.setValue(6444);
    const updatePortEmitter = wrapper.emitted().updatePort;

    expect(updatePortEmitter).toBeTruthy();
    expect(updatePortEmitter.value).toBe(6444);
  });
});
