<script lang="ts">
import os from 'os';

import Vue from 'vue';

import SystemPreferences from '@pkg/components/SystemPreferences.vue';
import { defaultSettings, Settings } from '@pkg/config/settings';
import { RecursiveTypes } from '@pkg/utils/typeUtils';

import type { PropType } from 'vue';

export default Vue.extend({
  name:       'preferences-body-virtual-machine',
  components: { SystemPreferences },
  props:      {
    preferences: {
      type:     Object as PropType<Settings>,
      required: true,
    },
  },
  data() {
    return { settings: defaultSettings };
  },
  computed: {
    hasSystemPreferences(): boolean {
      return !os.platform().startsWith('win');
    },
    availMemoryInGB(): number {
      return Math.ceil(os.totalmem() / 2 ** 30);
    },
    availNumCPUs(): number {
      return os.cpus().length;
    },
  },
  methods: {
    onChange<P extends keyof RecursiveTypes<Settings>>(property: P, value: RecursiveTypes<Settings>[P]) {
      this.$store.dispatch('preferences/updatePreferencesData', { property, value });
    },
  },
});
</script>

<template>
  <div class="preferences-content">
    <system-preferences
      v-if="hasSystemPreferences"
      :memory-in-g-b="preferences.virtualMachine.memoryInGB"
      :number-c-p-us="preferences.virtualMachine.numberCPUs"
      :avail-memory-in-g-b="availMemoryInGB"
      :avail-num-c-p-us="availNumCPUs"
      :reserved-memory-in-g-b="6"
      :reserved-num-c-p-us="1"
      @update:memory="onChange('virtualMachine.memoryInGB', $event)"
      @update:cpu="onChange('virtualMachine.numberCPUs', $event)"
    />
  </div>
</template>

<style lang="scss" scoped>
  .preferences-content {
    padding: var(--preferences-content-padding);
  }
</style>
