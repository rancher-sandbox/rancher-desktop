<script lang="ts">
import Vue from 'vue';
import { mapGetters } from 'vuex';

import Tabbed from '@/components/Tabbed/index.vue';
import Tab from '@/components/Tabbed/Tab.vue';
import PreferencesApplicationBehavior from '@/components/Preferences/ApplicationBehavior.vue';
import PreferencesApplicationEnvironment from '@/components/Preferences/ApplicationEnvironment.vue';
import PreferencesApplicationWsl from '@/components/Preferences/ApplicationWsl.vue';

export default Vue.extend({
  name:       'preferences-body-application',
  components: {
    Tabbed,
    Tab,
    PreferencesApplicationBehavior,
    PreferencesApplicationEnvironment,
    PreferencesApplicationWsl
  },
  props: {
    preferences: {
      type:     Object,
      required: true
    }
  },
  data() {
    return { activeTab: 'environment' };
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
    v-bind="$attrs"
    class="action-tabs"
    :no-content="true"
    @changed="tabSelected"
  >
    <tab
      v-if="!isPlatformWindows"
      label="Environment"
      name="environment"
      :weight="1"
    />
    <tab
      label="Behavior"
      name="behavior"
      :weight="2"
    />
    <tab
      v-if="isPlatformWindows"
      label="WSL"
      name="wsl"
      :weight="0"
    />
    <div class="application-content">
      <component
        :is="`preferences-application-${activeTab}`"
        :preferences="preferences"
        v-on="$listeners"
      />
    </div>
  </tabbed>
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
      border-bottom: 1px solid;
      border-color: var(--border);
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

      A {
        color: var(--muted);
      }

      &.active {
        border-color: var(--primary);
        background-color: transparent;

        A {
          color: var(--link);
        }
      }
    }
  }
</style>
