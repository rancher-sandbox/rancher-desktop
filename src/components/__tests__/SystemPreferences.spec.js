import { mount } from '@vue/test-utils'
import SystemPreferences from '../SystemPreferences.vue'
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

    let div1 =  wrapper.find("div#memoryInGBWrapper");
    let span1 = div1.find("div.vue-slider span.vue-slider-dot-tooltip-text");
    expect(span1.exists()).toBe(true);
    expect(span1.text()).toEqual("4");

    let div2 =  wrapper.find("div#numCPUWrapper");
    let span2 = div2.find("div.vue-slider span.vue-slider-dot-tooltip-text");
    expect(span2.exists()).toBe(true);
    expect(span2.text()).toEqual("5");
  });

  it("sets correct defaults", () => {
    let minimalProps = deepmerge(baseProps, {});
    delete minimalProps.memoryInGB;
    delete minimalProps.numberCPUs;
    const wrapper = createWrappedPage(minimalProps);
    expect(wrapper.props().memoryInGB).toBe(2);
    expect(wrapper.props().numberCPUs).toBe(2);
  })
})
