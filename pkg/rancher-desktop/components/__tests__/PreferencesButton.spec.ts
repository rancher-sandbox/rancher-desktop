import { shallowMount } from '@vue/test-utils';

import PreferencesButton from '../Preferences/ButtonOpen.vue';

describe('Preferences/ButtonOpen.vue', () => {
  it(`renders a button`, () => {
    const wrapper = shallowMount(PreferencesButton, { global: { mocks: { t: jest.fn() } } });

    expect(wrapper.find('button').classes()).toStrictEqual(['btn', 'role-secondary', 'btn-icon-text']);
  });

  it(`emits 'open-preferences' on click`, () => {
    const wrapper = shallowMount(PreferencesButton, { global: { mocks: { t: jest.fn() } } });

    wrapper.find('button').trigger('click');

    expect(wrapper.emitted('open-preferences')).toHaveLength(1);
  });
});
