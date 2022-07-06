<script lang="ts">
import os from 'os';
import { ipcRenderer } from 'electron';

import Vue from 'vue';
import { defaultSettings } from '@/config/settings';
import SystemPreferences from '@/components/SystemPreferences.vue';

export default Vue.extend({
  name:       'preferences-body-virtual-machine',
  components: { SystemPreferences },
  data() {
    return { settings: defaultSettings };
  },
  computed:   {
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
  beforeMount() {
    ipcRenderer.on('settings-read', (event, settings) => {
      this.settings = settings;
    });
    ipcRenderer.send('settings-read');
  },
  methods: {
    handleUpdateMemory(value: number) {
      this.settings.kubernetes.memoryInGB = value;
      ipcRenderer.invoke('settings-write',
        { kubernetes: { memoryInGB: value } });
    },
    handleUpdateCPU(value: number) {
      this.settings.kubernetes.numberCPUs = value;
      ipcRenderer.invoke('settings-write',
        { kubernetes: { numberCPUs: value } });
    },
  }
});
</script>

<template>
  <div class="preferences-content">
    <system-preferences
      v-if="hasSystemPreferences"
      :memory-in-g-b="settings.kubernetes.memoryInGB"
      :number-c-p-us="settings.kubernetes.numberCPUs"
      :avail-memory-in-g-b="availMemoryInGB"
      :avail-num-c-p-us="availNumCPUs"
      :reserved-memory-in-g-b="6"
      :reserved-num-c-p-us="1"
      @update:memory="handleUpdateMemory"
      @update:cpu="handleUpdateCPU"
    />
  </div>
</template>

<style lang="scss" scoped>
  .preferences-content {
    padding: var(--preferences-content-padding);
  }
</style>
