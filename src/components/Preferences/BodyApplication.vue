<script lang="ts">
import Vue from 'vue';
import { mapGetters } from 'vuex';
import type { PropType } from 'vue';

import Tabbed from '@/components/Tabbed/index.vue';
import Tab from '@/components/Tabbed/Tab.vue';
import PreferencesApplicationBehavior from '@/components/Preferences/ApplicationBehavior.vue';
import PreferencesApplicationEnvironment from '@/components/Preferences/ApplicationEnvironment.vue';
import { Settings } from '@/config/settings';

export default Vue.extend({
  name:       'preferences-body-application',
  components: {
    Tabbed,
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
  <tabbed
    v-if="!isPlatformWindows"
    v-bind="$attrs"
    class="action-tabs"
    :no-content="true"
    @changed="tabSelected"
  >
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
    <div class="application-content">
      <component
        :is="`preferences-application-${ activeTab }`"
        :preferences="preferences"
        v-on="$listeners"
      />
    </div>
  </tabbed>
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

  .action-tabs {
    display: flex;
    flex-direction: column;
    max-height: 100%;

    ::v-deep .tabs {
      border-bottom: 1px solid var(--border);

      a {
        text-decoration: none;
      }
    }

    ::v-deep .tab-container {
      max-height: 100%;
      overflow: auto;
      background-color: transparent;
    }

    ::v-deep li.tab {
      margin-right: 0;
      padding-right: 0;
      border-bottom: 1px solid var(--border);

      &.active {
        border-color: var(--primary);
        background-color: transparent;

        a {
          color: var(--link);
          text-decoration: none;
        }
      }
    }
  }
</style>
