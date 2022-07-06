import { shallowMount } from '@vue/test-utils';
import Header from '../Header.vue';
import PreferencesButton from '../Preferences/ButtonOpen.vue';

describe('Header.vue', () => {
  it('renders the preferences button when showPreferences is true', () => {
    const wrapper = shallowMount(
      Header,
      { mocks: { $config: { showPreferences: true } } }
    );

    expect(wrapper.findComponent(PreferencesButton).exists()).toBe(true);
  });

  it('does not render the preferences button when showPreferences is false', () => {
    const wrapper = shallowMount(
      Header,
      { mocks: { $config: { showPreferences: false } } }
    );

    expect(wrapper.findComponent(PreferencesButton).exists()).toBe(false);
  });

  it(`emits 'open-preferences' when PreferencesButton emits 'open-preferences'`, () => {
    const wrapper = shallowMount(
      Header,
      { mocks: { $config: { showPreferences: true } } }
    );

    wrapper.findComponent(PreferencesButton).vm.$emit('open-preferences');

    expect(wrapper.emitted('open-preferences')).toHaveLength(1);
  });
});
