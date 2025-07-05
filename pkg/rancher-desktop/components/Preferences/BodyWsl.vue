<script lang="ts">

import { Component, defineComponent } from 'vue';
import { mapGetters, mapState } from 'vuex';

import PreferencesWslIntegrations from '@pkg/components/Preferences/WslIntegrations.vue';
import PreferencesWslProxy from '@pkg/components/Preferences/WslProxy.vue';
import RdTabbed from '@pkg/components/Tabbed/RdTabbed.vue';
import Tab from '@pkg/components/Tabbed/Tab.vue';
import { Settings } from '@pkg/config/settings';
import type { TransientSettings } from '@pkg/config/transientSettings';
import type { ServerState } from '@pkg/main/commandServer/httpCommandServer';
import { RecursivePartial } from '@pkg/utils/typeUtils';

import type { PropType } from 'vue';

export default defineComponent({
  name:       'preferences-body-wsl',
  components: {
    RdTabbed, Tab, PreferencesWslIntegrations, PreferencesWslProxy,
  },
  props: {
    preferences: {
      type:     Object as PropType<Settings>,
      required: true,
    },
  },
  computed: {
    ...mapGetters('transientSettings', ['getActiveTab']),
    ...mapState('credentials', ['credentials']),
    activeTab(): string {
      return this.getActiveTab || 'integration';
    },
  },
  methods: {
    async tabSelected({ tab }: { tab: Component }) {
      if (this.activeTab !== tab.name) {
        await this.commitPreferences(tab.name || '');
      }
    },
    async commitPreferences(tabName: string) {
      await this.$store.dispatch(
        'transientSettings/commitPreferences',
        {
          ...this.credentials as ServerState,
          payload: { preferences: { navItem: { currentTabs: { WSL: tabName } } } } as RecursivePartial<TransientSettings>,
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
        label="Integrations"
        name="integrations"
        :weight="2"
      />
      <tab
        label="Proxy"
        name="proxy"
        :weight="1"
      />
    </template>
    <div class="wsl-content">
      <component
        :is="`preferences-wsl-${ activeTab }`"
        :preferences="preferences"
      />
    </div>
  </rd-tabbed>
</template>

<style lang="scss" scoped>
  .wsl-content {
    padding: var(--preferences-content-padding);
  }
</style>
