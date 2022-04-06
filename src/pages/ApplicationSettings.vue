<router lang="yaml">
  name: Application Settings
</router>
<template>
  <path-management-selector
    :value="pathManagementStrategy"
    @input="writeSettings"
  />
</template>

<script lang="ts">
import Vue from 'vue';
import { ipcRenderer } from 'electron';
import { mapGetters } from 'vuex';
import { PathManagementStrategy } from '@/integrations/pathManager';
import PathManagementSelector from '~/components/PathManagementSelector.vue';

export default Vue.extend({
  components: { PathManagementSelector },
  computed:   { ...mapGetters('applicationSettings', { pathManagementStrategy: 'getPathManagementStrategy' }) },
  mounted() {
    this.$store.dispatch(
      'page/setHeader',
      { title: 'Application Settings' }
    );

    ipcRenderer.on('settings-read', (_event, settings) => {
      this.$store.dispatch('applicationSettings/setPathManagementStrategy', settings.pathManagementStrategy);
    });

    ipcRenderer.send('settings-read');

    ipcRenderer.on('settings-update', (_event, settings) => {
      this.$store.dispatch('applicationSettings/setPathManagementStrategy', settings.pathManagementStrategy);
    });
  },
  methods: {
    writeSettings(val: PathManagementStrategy) {
      ipcRenderer.invoke(
        'settings-write',
        { pathManagementStrategy: val }
      );
    }
  }
});
</script>
