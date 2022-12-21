<script lang="ts">

import Vue from 'vue';
import { mapGetters, mapState } from 'vuex';

import PreferencesApplicationBehavior from '@pkg/components/Preferences/ApplicationBehavior.vue';
import PreferencesApplicationEnvironment from '@pkg/components/Preferences/ApplicationEnvironment.vue';
import RdTabbed from '@pkg/components/Tabbed/RdTabbed.vue';
import Tab from '@pkg/components/Tabbed/Tab.vue';
import { Settings } from '@pkg/config/settings';
import type { TransientSettings } from '@pkg/config/transientSettings';
import type { ServerState } from '@pkg/main/commandServer/httpCommandServer';
import { RecursivePartial } from '@pkg/utils/typeUtils';

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
      required: true,
    },
  },
  async fetch() {
    await this.$store.dispatch('credentials/fetchCredentials');
  },
  computed: {
    ...mapGetters('preferences', ['isPlatformWindows']),
    ...mapGetters('transientSettings', ['getActiveTab']),
    ...mapState('credentials', ['credentials']),
    activeTab(): string {
      return this.getActiveTab || 'behavior';
    },
  },
  methods: {
    async tabSelected({ tab }: { tab: Vue.Component }) {
      if (this.activeTab !== tab.name) {
        await this.commitPreferences(tab.name || '');
      }
    },
    async commitPreferences(tabName: string) {
      await this.$store.dispatch(
        'transientSettings/commitPreferences',
        {
          ...this.credentials as ServerState,
          payload: { preferences: { navItem: { currentTabs: { Application: tabName } } } } as RecursivePartial<TransientSettings>,
        },
      );
    },
  },
});
</script>

<template>
  <rd-tabbed
    v-if="!isPlatformWindows"
    v-bind="$attrs"
    class="action-tabs"
    :no-content="true"
    :default-tab="activeTab"
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
