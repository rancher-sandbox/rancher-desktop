import { mount } from '@vue/test-utils'
import MinikubeMemory from '../MinikubeMemory.vue'
import merge from 'lodash/merge';

// Uncomment this code when moving to vuejs v3:
// class ShadowRootShadowClass {
//   // Because the code's not a browser there is no ShadowRoot
//   // defined for vue to work on.
//   // See node_modules/@vue/runtime-dom/dist/runtime-dom.cjs.js:1260 for context
// }

function safeMerge(baseProps, overrides) {
  let newProps = {};
  merge(newProps, baseProps, overrides);
  return newProps;
}
function createWrappedPage(props) {
  // v3: 'propsData' is just 'props'
  return mount(MinikubeMemory, { propsData: props });
}

function createWrappedPageGetErrorMessages(props) {
  const wrapper = createWrappedPage(props);
  const memoryErrorMessage =  wrapper.find("div#memoryInGBWrapper p.bad-input");
  const cpuErrorMessage = wrapper.find("div#numCPUWrapper p.bad-input");
  return [memoryErrorMessage, cpuErrorMessage];
}

const baseProps = {
  memoryInGB: '4',
  numberCPUs: 4,
  availMemoryInGB: 8,
  availNumCPUs: 6
};

describe('MinikubeMemory.vue', () => {
  // Uncomment this code when moving to vuejs v3:
  // beforeAll(() => {
  //   global.ShadowRoot = ShadowRootShadowClass;
  // })

  it("accepts valid data", async () => {
    const wrapper = createWrappedPage(baseProps);

    expect(wrapper.props().memoryInGB).toBe('4');
    expect(wrapper.props().numberCPUs).toBe(4);
    expect(wrapper.props().availMemoryInGB).toBe(8);
    expect(wrapper.props().availNumCPUs).toBe(6);

    // Don't test against the actual value field. See
    // https://stackoverflow.com/questions/65710738/why-is-the-value-attribute-not-showing-up-when-i-test-this-vue3-component
    // for details.
    expect(wrapper.html()).toMatch(/<label>memory in GB.*<input.*type="text"/s);
    expect(wrapper.html()).toMatch(/<label>number of CPUs.*<input.*type="number"/s);
    let div1 =  wrapper.find("div#memoryInGBWrapper");
    expect(div1.find("p.bad-input").exists()).toBe(false);
    let div2 = wrapper.find("div#numCPUWrapper");
    expect(div2.find("p.bad-input").exists()).toBe(false);
  });

  it("sets correct defaults", () => {
    let minimalProps = safeMerge(baseProps, {});
    delete minimalProps.memoryInGB;
    delete minimalProps.numberCPUs;
    const wrapper = createWrappedPage(minimalProps);
    expect(wrapper.props().memoryInGB).toBe('2');
    expect(wrapper.props().numberCPUs).toBe(2);
  })

  it ('complains about invalid memory', () => {
    let newProps = safeMerge(baseProps, {memoryInGB: '37abc'} );
    const [memoryErrorMessage, cpuErrorMessage] = createWrappedPageGetErrorMessages(newProps);

    expect(memoryErrorMessage.exists()).toBe(true);
    expect(memoryErrorMessage.text()).toContain("Contains non-numeric characters");

    expect(cpuErrorMessage.exists()).toBe(false);
  });

  it ('complains about oversize memory', () => {
    let newProps = safeMerge(baseProps, {memoryInGB: '55', availMemoryInGB: 54} );
    const [memoryErrorMessage, cpuErrorMessage] = createWrappedPageGetErrorMessages(newProps);

    expect(memoryErrorMessage.exists()).toBe(true);
    expect(memoryErrorMessage.text()).toContain("Specified value is too high, only 54 GB are available");

    expect(cpuErrorMessage.exists()).toBe(false);
  });

  it ('complains about oversize memory with singular case', () => {
    let newProps = safeMerge(baseProps, {memoryInGB: '55', availMemoryInGB: 1} );
    const [memoryErrorMessage, cpuErrorMessage] = createWrappedPageGetErrorMessages(newProps);

    expect(memoryErrorMessage.exists()).toBe(true);
    expect(memoryErrorMessage.text()).toContain("Specified value is too high, only 1 GB is available");

    expect(cpuErrorMessage.exists()).toBe(false);
  });

  it ('complains about missing memory value', () => {
    let newProps = safeMerge(baseProps, {memoryInGB: ''} );
    const [memoryErrorMessage, cpuErrorMessage] = createWrappedPageGetErrorMessages(newProps);

    expect(memoryErrorMessage.exists()).toBe(true);
    expect(memoryErrorMessage.text()).toContain("No value provided");

    expect(cpuErrorMessage.exists()).toBe(false);
  });

  it ('complains about not enough CPUs', () => {
    let newProps = safeMerge(baseProps, {} );
    [-1, 0, 1].forEach((numCPUs) => {
      newProps.numberCPUs = numCPUs;
      let [memoryErrorMessage, cpuErrorMessage] = createWrappedPageGetErrorMessages(newProps);

      expect(memoryErrorMessage.exists()).toBe(false);

      expect(cpuErrorMessage.exists()).toBe(true);
      expect(cpuErrorMessage.text()).toContain("Invalid value: Specified value is too low, must be at least 2 (GB)");
    })
  });

  it ('complains about too many size CPUs', () => {
    let newProps = safeMerge(baseProps, {numberCPUs: 55, availNumCPUs: 54} );
    const [memoryErrorMessage, cpuErrorMessage] = createWrappedPageGetErrorMessages(newProps);

    expect(memoryErrorMessage.exists()).toBe(false);

    expect(cpuErrorMessage.exists()).toBe(true);
    expect(cpuErrorMessage.text()).toContain("Specified value is too high, only 54 CPUs are available");
  });

  it ('complains about too many CPUs with singular case', () => {
    let newProps = safeMerge(baseProps, {numberCPUs: 55, availNumCPUs: 1} );
    const [memoryErrorMessage, cpuErrorMessage] = createWrappedPageGetErrorMessages(newProps);

    expect(memoryErrorMessage.exists()).toBe(false);

    expect(cpuErrorMessage.exists()).toBe(true);
    expect(cpuErrorMessage.text()).toContain("Specified value is too high, only 1 CPU is available");
  });
})
