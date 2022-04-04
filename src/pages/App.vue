<router lang="yaml">
  name: Host/App
</router>
<template>
  <path-management-selector
    :value="settings.pathManagementStrategy"
    @input="updatePath"
  />
</template>

<script lang="ts">
import Vue from 'vue';
import { ipcRenderer } from 'electron';
import { Settings } from '@/config/settings';
import { PathManagementStrategy } from '@/integrations/pathManager';
import PathManagementSelector from '~/components/PathManagementSelector.vue';

export default Vue.extend({
  components: { PathManagementSelector },
  data() {
    return { settings: { kubernetes: {} } as Settings };
  },
  mounted() {
    this.$store.dispatch(
      'page/setHeader',
      { title: 'Host/App' }
    );

    ipcRenderer.on('settings-read', (_event, settings) => {
      this.settings = settings;
    });

    ipcRenderer.send('settings-read');
  },
  methods: {
    updatePath(val: PathManagementStrategy) {
      this.settings.pathManagementStrategy = val;
      this.writeSettings();
    },
    writeSettings() {
      ipcRenderer.invoke(
        'settings-write',
        { pathManagementStrategy: this.settings.pathManagementStrategy }
      );
    }
  }
});
</script>
