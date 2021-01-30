import { mount } from '@vue/test-utils'
import SystemPreferences from '@/components/SystemPreferences.vue'
const deepmerge = require('deepmerge');

function createWrappedPage(props) {
  return mount(SystemPreferences, { propsData: props });
}

const baseProps = {
  memoryInGB: 4,
  numberCPUs: 5,
  availMemoryInGB: 8,
  availNumCPUs: 6
};

describe('SystemPreferences.vue', () => {

  it("accepts valid data", async () => {
    const wrapper = createWrappedPage(baseProps);

    expect(wrapper.props().memoryInGB).toBe(4);
    expect(wrapper.props().numberCPUs).toBe(5);
    expect(wrapper.props().availMemoryInGB).toBe(8);
    expect(wrapper.props().availNumCPUs).toBe(6);

    let slider1 =  wrapper.find("div#memoryInGBWrapper div.vue-slider.vue-slider-disabled");
    expect(slider1.exists()).toBeFalsy();
    let slider2 =  wrapper.find("div#numCPUWrapper div.vue-slider.vue-slider-disabled");
    expect(slider2.exists()).toBeFalsy();

    let div1 =  wrapper.find("div#memoryInGBWrapper");
    let span1 = div1.find("div.vue-slider div.vue-slider-dot");
    expect(span1.exists()).toBeTruthy();
    expect(span1.attributes("aria-valuemin")).toEqual('2');
    expect(span1.attributes("aria-valuenow")).toEqual('4');
    expect(span1.attributes("aria-valuemax")).toEqual('8');

    let div2 =  wrapper.find("div#numCPUWrapper");
    let span2 = div2.find("div.vue-slider div.vue-slider-dot");
    expect(span2.exists()).toBeTruthy();
    expect(span2.attributes("aria-valuemin")).toEqual('1');
    expect(span2.attributes("aria-valuenow")).toEqual('5');
    expect(span2.attributes("aria-valuemax")).toEqual('6');
  });

  it("sets correct defaults and is enabled", () => {
    let minimalProps = deepmerge(baseProps, {});
    delete minimalProps.memoryInGB;
    delete minimalProps.numberCPUs;
    const wrapper = createWrappedPage(minimalProps);
    expect(wrapper.props().memoryInGB).toBe(2);
    expect(wrapper.props().numberCPUs).toBe(2);
    let slider1 =  wrapper.find("div#memoryInGBWrapper div.vue-slider.vue-slider-disabled");
    expect(slider1.exists()).toBeFalsy();
    let slider2 =  wrapper.find("div#numCPUWrapper div.vue-slider.vue-slider-disabled");
    expect(slider2.exists()).toBeFalsy();

    let div1 =  wrapper.find("div#memoryInGBWrapper");
    let span1 = div1.find("div.vue-slider div.vue-slider-dot");
    expect(span1.exists()).toBe(true);
    expect(span1.attributes("aria-valuemin")).toEqual('2');
    expect(span1.attributes("aria-valuenow")).toEqual('2');
    expect(span1.attributes("aria-valuemax")).toEqual('8');

    let div2 =  wrapper.find("div#numCPUWrapper");
    let span2 = div2.find("div.vue-slider div.vue-slider-dot");
    expect(span2.exists()).toBe(true);
    expect(span2.attributes("aria-valuemin")).toEqual('1');
    expect(span2.attributes("aria-valuenow")).toEqual('2');
    expect(span2.attributes("aria-valuemax")).toEqual('6');
  })

  // Note that k8s.vue should adjust these values so we don't see this
  it("disables widgets when no options are possible", () => {
    let minimalProps = {
      memoryInGB: 4,
      numberCPUs: 1,
      availMemoryInGB: 2,
      availNumCPUs: 1
    };
    const wrapper = createWrappedPage(minimalProps);
    let slider1 =  wrapper.find("div#memoryInGBWrapper div.vue-slider.vue-slider-disabled");
    expect(slider1.exists()).toBeTruthy();
    expect(slider1.find("div.vue-slider-rail div.vue-slider-dot.vue-slider-dot-disabled").exists()).toBeTruthy();

    let slider2 =  wrapper.find("div#numCPUWrapper div.vue-slider.vue-slider-disabled");
    expect(slider2.exists()).toBeTruthy();
    expect(slider2.find("div.vue-slider-rail div.vue-slider-dot.vue-slider-dot-disabled").exists()).toBeTruthy();
  })
})
