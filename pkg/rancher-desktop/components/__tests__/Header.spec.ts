import { shallowMount } from '@vue/test-utils';

import Header from '../Header.vue';
import PreferencesButton from '../Preferences/ButtonOpen.vue';

describe('Header.vue', () => {
  it('renders the preferences button', () => {
    const wrapper = shallowMount(Header);

    expect(wrapper.findComponent(PreferencesButton).exists()).toBe(true);
  });

  it(`emits 'open-preferences' when PreferencesButton emits 'open-preferences'`, () => {
    const wrapper = shallowMount(Header);

    wrapper.findComponent(PreferencesButton).vm.$emit('open-preferences');

    expect(wrapper.emitted('open-preferences')).toHaveLength(1);
  });
});
