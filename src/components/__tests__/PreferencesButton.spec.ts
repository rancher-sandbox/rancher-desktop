import { shallowMount } from '@vue/test-utils';

import PreferencesButton from '../Preferences/ButtonOpen.vue';

describe('Preferences/ButtonOpen.vue', () => {
  it(`renders a button`, () => {
    const wrapper = shallowMount(PreferencesButton, {});

    expect(wrapper.find('button').classes()).toStrictEqual(['btn', 'role-fab', 'ripple']);
  });

  it(`emits 'open-preferences' on click`, () => {
    const wrapper = shallowMount(
      PreferencesButton,
      { });

    wrapper.find('button').trigger('click');

    expect(wrapper.emitted('open-preferences')).toHaveLength(1);
  });
});
