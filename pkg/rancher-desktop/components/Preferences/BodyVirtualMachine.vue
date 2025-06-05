<script lang="ts">
import os from 'os';

import { Component, defineComponent } from 'vue';
import { mapGetters, mapState } from 'vuex';

import PreferencesVirtualMachineEmulation from '@pkg/components/Preferences/VirtualMachineEmulation.vue';
import PreferencesVirtualMachineHardware from '@pkg/components/Preferences/VirtualMachineHardware.vue';
import PreferencesVirtualMachineVolumes from '@pkg/components/Preferences/VirtualMachineVolumes.vue';
import RdTabbed from '@pkg/components/Tabbed/RdTabbed.vue';
import Tab from '@pkg/components/Tabbed/Tab.vue';
import { Settings } from '@pkg/config/settings';
import type { ServerState } from '@pkg/main/commandServer/httpCommandServer';

import type { PropType } from 'vue';

export default defineComponent({
  name:       'preferences-body-virtual-machine',
  components: {
    RdTabbed,
    Tab,
    PreferencesVirtualMachineHardware,
    PreferencesVirtualMachineVolumes,
    PreferencesVirtualMachineEmulation,
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
    isPlatformDarwin(): boolean {
      return os.platform() === 'darwin';
    },
  },
  methods: {
    async tabSelected({ tab }: { tab: Component }) {
      if (this.activeTab !== tab.name) {
        await this.navigate('Virtual Machine', tab.name || '');
      }
    },
    async navigate(navItem: string, tab: string) {
      await this.$store.dispatch(
        'transientSettings/navigatePrefDialog',
        {
          ...this.credentials as ServerState,
          navItem,
          tab,
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
    :active-tab="activeTab"
    @changed="tabSelected"
  >
    <template #tabs>
      <tab
        v-if="isPlatformDarwin"
        label="Emulation"
        name="emulation"
        :weight="1"
      />
      <tab
        label="Volumes"
        name="volumes"
        :weight="3"
      />
      <tab
        label="Hardware"
        name="hardware"
        :weight="4"
      />
    </template>
    <div class="virtual-machine-content">
      <component
        :is="`preferences-virtual-machine-${ activeTab }`"
        :preferences="preferences"
        v-on="$listeners"
      />
    </div>
  </rd-tabbed>
</template>

<style lang="scss" scoped>
  .virtual-machine-content {
    padding: var(--preferences-content-padding);
  }
</style>
