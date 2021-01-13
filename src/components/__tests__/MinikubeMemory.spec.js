import { mount } from '@vue/test-utils'
import MinikubeMemory from '../MinikubeMemory.vue'
// const deepmerge = require('deepmerge');

class ShadowRootShadowClass {
  // Because the code's not a browser there is no ShadowRoot
  // defined for vue to work on.
  // See node_modules/@vue/runtime-dom/dist/runtime-dom.cjs.js:1260 for context
}

function createWrappedPage(props) {
  return mount(MinikubeMemory, { props: props });
}

describe('MinikubeMemory.vue', () => {
  beforeAll(() => {
    global.ShadowRoot = ShadowRootShadowClass;
  })

  it('formats the props correctly', () => {
    const wrapper = createWrappedPage( { memory_in_gb: 37 });
    expect(wrapper.props().memory_in_gb).toBe(37);
    // Don't test against the actual value field. See
    // https://stackoverflow.com/questions/65710738/why-is-the-value-attribute-not-showing-up-when-i-test-this-vue3-component
    // for details.
    expect(wrapper.html()).toMatch(/<label>memory in GB.*<input.*type="text"/)
  })
})
