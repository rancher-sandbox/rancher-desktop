<script lang="ts">

import Vue from 'vue';
import { mapGetters, mapState } from 'vuex';

import PreferencesVirtualMachineHardware from '@pkg/components/Preferences/VirtualMachineHardware.vue';
import RdTabbed from '@pkg/components/Tabbed/RdTabbed.vue';
import Tab from '@pkg/components/Tabbed/Tab.vue';
import { Settings } from '@pkg/config/settings';
import type { TransientSettings } from '@pkg/config/transientSettings';
import type { ServerState } from '@pkg/main/commandServer/httpCommandServer';
import { RecursivePartial } from '@pkg/utils/typeUtils';

import type { PropType } from 'vue';

export default Vue.extend({
  name:       'preferences-body-virtual-machine',
  components: {
    RdTabbed,
    Tab,
    PreferencesVirtualMachineHardware,
  },
  props: {
    preferences: {
      type:     Object as PropType<Settings>,
      required: true,
    },
  },
  computed: {
    ...mapGetters('preferences', ['isPlatformWindows']),
    ...mapGetters('transientSettings', ['getActiveTab']),
    ...mapState('credentials', ['credentials']),
    activeTab(): string {
      return this.getActiveTab || 'hardware';
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
          payload: { preferences: { navItem: { currentTabs: { 'Virtual Machine': tabName } } } } as RecursivePartial<TransientSettings>,
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
        label="Hardware"
        name="hardware"
        :weight="1"
      />
    </template>
    <div class="virtual-machine-content">
      <component
        :is="`preferences-virtual-machine-${ activeTab }`"
        :preferences="preferences"
      />
    </div>
  </rd-tabbed>
</template>

<style lang="scss" scoped>
  .virtual-machine-content {
    padding: var(--preferences-content-padding);
  }
</style>
