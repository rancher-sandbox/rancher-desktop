<script lang="ts">
import Vue from 'vue';
import Tabbed from '@/components/Tabbed/index.vue';
import Tab from '@/components/Tabbed/Tab.vue';
import PreferencesApplicationBehavior from '@/components/PreferencesApplicationBehavior.vue';

export default Vue.extend({
  name:       'preferences-body-application',
  components: {
    Tabbed, Tab, PreferencesApplicationBehavior
  },
  methods:    {
    tabSelected(tab: string) {
      console.debug('TAB SELECTED', { tab });
    }
  }
});
</script>

<template>
  <tabbed
    v-bind="$attrs"
    default-tab="pull"
    class="action-tabs"
    :no-content="true"
    @changed="tabSelected"
  >
    <tab
      label="Environment"
      name="environment"
      :weight="0"
    />
    <tab
      label="Behavior"
      name="behavior"
      :weight="1"
    />
    <preferences-application-behavior />
  </tabbed>
</template>
