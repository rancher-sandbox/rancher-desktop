import deepmerge from 'deepmerge';
import { mount } from '@vue/test-utils';

import SystemPreferences from '../SystemPreferences.vue';

function createWrappedPage(props) {
  return mount(SystemPreferences, { props, global: {
    directives: { tooltip: {} },
  } });
}

const baseProps = {
  memoryInGB:         4,
  numberCPUs:         5,
  availMemoryInGB:    8,
  availNumCPUs:       6,
  minMemoryInGB:      2,
  minNumCPUs:         1,
  reservedMemoryInGB: 3,
  reservedNumCPUs:    1,
};

describe('SystemPreferences.vue', () => {
  it('accepts valid data', () => {
    const wrapper = createWrappedPage(baseProps);

    expect(wrapper.props().memoryInGB).toBe(4);
    expect(wrapper.props().numberCPUs).toBe(5);
    expect(wrapper.props().availMemoryInGB).toBe(8);
    expect(wrapper.props().availNumCPUs).toBe(6);

    const slider1 = wrapper.find('#memoryInGBWrapper div.vue-slider.vue-slider-disabled');

    expect(slider1.exists()).toBeFalsy();
    const slider2 = wrapper.find('#numCPUWrapper div.vue-slider.vue-slider-disabled');

    expect(slider2.exists()).toBeFalsy();

    const div1 = wrapper.find('#memoryInGBWrapper');
    const span1 = div1.find('div.vue-slider div.vue-slider-dot');

    expect(span1.exists()).toBeTruthy();
    expect(span1.attributes('aria-valuemin')).toEqual('2');
    expect(span1.attributes('aria-valuenow')).toEqual('4');
    expect(span1.attributes('aria-valuemax')).toEqual('8');

    const div2 = wrapper.find('#numCPUWrapper');
    const span2 = div2.find('div.vue-slider div.vue-slider-dot');

    expect(span2.exists()).toBeTruthy();
    expect(span2.attributes('aria-valuemin')).toEqual('1');
    expect(span2.attributes('aria-valuenow')).toEqual('5');
    expect(span2.attributes('aria-valuemax')).toEqual('6');
    expect(span2.attributes('aria-valuemin')).toEqual('1');
    expect(span2.attributes('aria-valuenow')).toEqual('5');
    expect(span2.attributes('aria-valuemax')).toEqual('6');
  });

  it('sets correct defaults and is enabled', () => {
    const minimalProps = deepmerge(baseProps, {});

    delete minimalProps.memoryInGB;
    delete minimalProps.numberCPUs;
    const wrapper = createWrappedPage(minimalProps);

    expect(wrapper.props().memoryInGB).toBe(2);
    expect(wrapper.props().numberCPUs).toBe(2);
    const slider1 = wrapper.find('#memoryInGBWrapper div.vue-slider.vue-slider-disabled');

    expect(slider1.exists()).toBeFalsy();
    const slider2 = wrapper.find('#numCPUWrapper div.vue-slider.vue-slider-disabled');

    expect(slider2.exists()).toBeFalsy();

    const div1 = wrapper.find('#memoryInGBWrapper');
    const span1 = div1.find('div.vue-slider div.vue-slider-dot');

    expect(span1.exists()).toBe(true);
    expect(span1.attributes('aria-valuemin')).toEqual('2');
    expect(span1.attributes('aria-valuenow')).toEqual('2');
    expect(span1.attributes('aria-valuemax')).toEqual('8');

    const div2 = wrapper.find('#numCPUWrapper');
    const span2 = div2.find('div.vue-slider div.vue-slider-dot');

    expect(span2.exists()).toBe(true);
    expect(span2.attributes('aria-valuemin')).toEqual('1');
    expect(span2.attributes('aria-valuenow')).toEqual('2');
    expect(span2.attributes('aria-valuemax')).toEqual('6');
  });

  // Note that k8s.vue should adjust these values so we don't see this
  it('disables widgets when no options are possible', () => {
    const minimalProps = {
      memoryInGB:      4,
      numberCPUs:      1,
      availMemoryInGB: 2,
      availNumCPUs:    1,
    };
    const wrapper = createWrappedPage(minimalProps);
    const slider1 = wrapper.find('#memoryInGBWrapper div.vue-slider.vue-slider-disabled');

    expect(slider1.exists()).toBeTruthy();
    expect(slider1.find('div.vue-slider-rail div.vue-slider-dot.vue-slider-dot-disabled').exists()).toBeTruthy();

    const slider2 = wrapper.find('#numCPUWrapper div.vue-slider.vue-slider-disabled');

    expect(slider2.exists()).toBeTruthy();
    expect(slider2.find('div.vue-slider-rail div.vue-slider-dot.vue-slider-dot-disabled').exists()).toBeTruthy();
  });

  it('marks reserved resources', () => {
    const wrapper = createWrappedPage(baseProps);
    const memory = wrapper.findComponent({ ref: 'memory' });

    // min 2 reserved 3 total 8, so total width = 6, marked section is 50% to 100%
    expect(memory.find('.vue-slider-process').element.style.left).toEqual('50%');
    expect(memory.find('.vue-slider-process').element.style.width).toEqual('50%');
    const cpu = wrapper.findComponent({ ref: 'cpu' });

    // min 1 reserved 1 total 6, so total width = 5, marked section is 80% to 100%
    expect(cpu.find('.vue-slider-process').element.style.left).toEqual('80%');
    expect(cpu.find('.vue-slider-process').element.style.width).toEqual('20%');
  });

  describe('throw on console.error', () => {
    class VueSliderError extends Error {
    }

    let origError;

    beforeAll(() => {
      origError = console.error;
      console.error = (...args) => {
        throw new VueSliderError(...args);
      };
    });
    afterAll(() => {
      console.error = origError;
    });

    const checkForError = (func, expectedMessage) => {
      expect(func).toThrow(new VueSliderError(expectedMessage));
    };

    it('the sliders detect invalid values', async() => {
      const wrapper = createWrappedPage(baseProps);

      const div1 = wrapper.getComponent('#memoryInGBWrapper');
      const slider1 = div1.getComponent({ref: 'slider'});
      const span1 = slider1.get('div.vue-slider-dot');
      const slider1vm = slider1.vm;

      for (let i = 2; i <= baseProps.availMemoryInGB; i++) {
        await slider1vm.setValue(i);
        expect(span1.attributes('aria-valuenow')).toEqual(i.toString());
        expect(slider1vm.getValue()).toBe(i);
      }
      checkForError(() => {
        slider1vm.setValue(1);
      }, '[VueSlider error]: The "value" must be greater than or equal to the "min".');

      checkForError(() => {
        slider1vm.setValue(baseProps.availMemoryInGB + 1);
      }, '[VueSlider error]: The "value" must be less than or equal to the "max".');

      const div2 = wrapper.getComponent('#numCPUWrapper');
      const slider2 = div2.getComponent({ref: 'slider'});
      const slider2vm = slider2.vm;
      const span2 = slider2.get('div.vue-slider-dot');

      for (let i = 1; i <= baseProps.availNumCPUs; i++) {
        await slider2vm.setValue(i);
        expect(span2.attributes('aria-valuenow')).toEqual(i.toString());
        expect(slider2vm.getValue()).toBe(i);
      }

      checkForError(() => {
        slider2vm.setValue(0);
      }, '[VueSlider error]: The "value" must be greater than or equal to the "min".');

      checkForError(() => {
        slider2vm.setValue(baseProps.availNumCPUs + 1);
      }, '[VueSlider error]: The "value" must be less than or equal to the "max".');
    });
  });

  it('emits events', async() => {
    const wrapper = createWrappedPage(baseProps);

    const div1 = wrapper.getComponent('#memoryInGBWrapper');
    const slider1 = div1.getComponent({ref: 'slider'});
    const slider1vm = slider1.vm;

    await slider1vm.setValue(3);
    const updateMemoryEmitter = wrapper.emitted()['update:memory'];

    expect(updateMemoryEmitter).toBeTruthy();
    expect(updateMemoryEmitter.length).toBe(1);
    expect(updateMemoryEmitter[0]).toEqual([3]);
    await slider1vm.setValue(5);
    expect(updateMemoryEmitter.length).toBe(2);
    expect(updateMemoryEmitter[0]).toEqual([3]);
    expect(updateMemoryEmitter[1]).toEqual([5]);

    const div2 = wrapper.getComponent('#numCPUWrapper');
    const slider2 = div2.getComponent({ref: 'slider'});
    const slider2vm = slider2.vm;

    await slider2vm.setValue(2);
    const updateCPUEmitter = wrapper.emitted()['update:cpu'];

    expect(updateCPUEmitter).toBeTruthy();
    expect(updateCPUEmitter.length).toBe(1);
    expect(updateCPUEmitter[0]).toEqual([2]);
    await slider2vm.setValue(4);
    expect(updateCPUEmitter.length).toBe(2);
    expect(updateCPUEmitter[0]).toEqual([2]);
    expect(updateCPUEmitter[1]).toEqual([4]);
  });
});
