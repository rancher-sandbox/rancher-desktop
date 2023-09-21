<script lang="ts">

import PreferencesApplicationBehavior from '@pkg/components/Preferences/ApplicationBehavior.vue';
import PreferencesApplicationEnvironment from '@pkg/components/Preferences/ApplicationEnvironment.vue';
import PreferencesApplicationGeneral from '@pkg/components/Preferences/ApplicationGeneral.vue';
import RdTabbed from '@pkg/components/Tabbed/RdTabbed.vue';
import Tab from '@pkg/components/Tabbed/Tab.vue';
import { Settings } from '@pkg/config/settings';
import { RecursivePartial } from '@pkg/utils/typeUtils';
import Vue from 'vue';
import { mapGetters, mapState } from 'vuex';

import type { TransientSettings } from '@pkg/config/transientSettings';
import type { ServerState } from '@pkg/main/commandServer/httpCommandServer';

import type { PropType } from 'vue';

export default Vue.extend({
  name:       'preferences-body-application',
  components: {
    RdTabbed,
    Tab,
    PreferencesApplicationBehavior,
    PreferencesApplicationEnvironment,
    PreferencesApplicationGeneral,
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
    v-bind="$attrs"
    class="action-tabs"
    :no-content="true"
    :default-tab="activeTab"
    @changed="tabSelected"
  >
    <template #tabs>
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
        label="General"
        name="general"
        :weight="3"
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
</template>

<style lang="scss" scoped>
  .application-content {
    padding: var(--preferences-content-padding);
  }
</style>
