<script lang="ts">
import Vue from 'vue';
import Tabbed from '@/components/Tabbed/index.vue';
import Tab from '@/components/Tabbed/Tab.vue';
import PreferencesApplicationBehavior from '@/components/PreferencesApplicationBehavior.vue';
import PreferencesApplicationEnvironment from '@/components/PreferencesApplicationEnvironment.vue';

export default Vue.extend({
  name:       'preferences-body-application',
  components: {
    Tabbed, Tab, PreferencesApplicationBehavior, PreferencesApplicationEnvironment
  },
  data() {
    return { activeTab: 'environment' };
  },
  methods:    {
    tabSelected({ tab }: { tab: any }) {
      this.activeTab = tab.name;
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
    <div class="application-content">
      <component :is="`preferences-application-${activeTab}`" />
    </div>
  </tabbed>
</template>

<style lang="scss" scoped>
  .application-content {
    padding: 0.75rem;
  }
</style>
