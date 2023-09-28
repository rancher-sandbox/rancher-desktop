<script lang="ts">

import Vue from 'vue';
import { mapGetters, mapState } from 'vuex';

import PreferencesContainerEngineAllowedImages from '@pkg/components/Preferences/ContainerEngineAllowedImages.vue';
import PreferencesContainerEngineGeneral from '@pkg/components/Preferences/ContainerEngineGeneral.vue';
import RdTabbed from '@pkg/components/Tabbed/RdTabbed.vue';
import Tab from '@pkg/components/Tabbed/Tab.vue';
import { Settings } from '@pkg/config/settings';
import { TransientSettings } from '@pkg/config/transientSettings';
import { ServerState } from '@pkg/main/credentialServer/httpCredentialHelperServer';
import { RecursivePartial } from '@pkg/utils/typeUtils';

import type { PropType } from 'vue';

export default Vue.extend({
  name:       'preferences-body-container-engine',
  components: {
    PreferencesContainerEngineAllowedImages,
    PreferencesContainerEngineGeneral,
    RdTabbed,
    Tab,
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
      return this.getActiveTab || 'general';
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
          payload: { preferences: { navItem: { currentTabs: { 'Container Engine': tabName } } } } as RecursivePartial<TransientSettings>,
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
        label="General"
        name="general"
        :weight="2"
      />
      <tab
        label="Allowed Images"
        name="allowed-images"
        :weight="1"
      />
    </template>
    <div class="container-engine-content">
      <component
        :is="`preferences-container-engine-${ activeTab }`"
        :preferences="preferences"
        v-on="$listeners"
      />
    </div>
  </rd-tabbed>
</template>

<style lang="scss" scoped>
  .container-engine-content {
    padding: var(--preferences-content-padding);
  }
</style>
