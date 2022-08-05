<script lang="ts">
import Vue from 'vue';
import { mapGetters } from 'vuex';

import PreferencesApplicationBehavior from '@/components/Preferences/ApplicationBehavior.vue';
import PreferencesApplicationEnvironment from '@/components/Preferences/ApplicationEnvironment.vue';
import RdTabbed from '@/components/Tabbed/RdTabbed.vue';
import Tab from '@/components/Tabbed/Tab.vue';
import { Settings } from '@/config/settings';

import type { PropType } from 'vue';

export default Vue.extend({
  name:       'preferences-body-application',
  components: {
    RdTabbed,
    Tab,
    PreferencesApplicationBehavior,
    PreferencesApplicationEnvironment,
  },
  props: {
    preferences: {
      type:     Object as PropType<Settings>,
      required: true
    }
  },
  data() {
    return { activeTab: 'behavior' };
  },
  computed: { ...mapGetters('preferences', ['isPlatformWindows']) },
  methods:    {
    tabSelected({ tab }: { tab: Vue.Component }) {
      this.activeTab = tab.name || '';
    }
  }
});
</script>

<template>
  <rd-tabbed
    v-if="!isPlatformWindows"
    v-bind="$attrs"
    class="action-tabs"
    :no-content="true"
    @changed="tabSelected"
  >
    <template #tabs>
      <tab
        label="Environment"
        name="environment"
        :weight="1"
      />
      <tab
        label="Behavior"
        name="behavior"
        :weight="2"
      />
    </template>
    <div class="application-content">
      <component
        :is="`preferences-application-${ activeTab }`"
        :preferences="preferences"
        v-on="$listeners"
      />
    </div>
  </rd-tabbed>
  <div v-else class="application-content">
    <preferences-application-behavior
      :preferences="preferences"
      v-on="$listeners"
    />
  </div>
</template>

<style lang="scss" scoped>
  .application-content {
    padding: var(--preferences-content-padding);
  }
</style>
