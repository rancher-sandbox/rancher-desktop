<router lang="yaml">
  name: WSL Integration
</router>

<script lang="ts">
import os from 'os';
import { ipcRenderer } from 'electron';
import Vue from 'vue';
import Integration from '@/components/Integration.vue';

export default Vue.extend({
  components: { Integration },
  data() {
    return {
      /** @type Record<string, boolean | string> */
      integrations:        {},
    };
  },
  computed:   {
    hasIntegration() {
      return os.platform().startsWith('win');
    },
    integrationTitle(): string {
      return this.t('integrations.windows.title');
    },
    integrationDescription(): string {
      return this.t('integrations.windows.description', { }, true);
    },
  },
  created() {
    this.$store.dispatch(
      'page/setHeader',
      {
        title:       this.integrationTitle,
        description: this.integrationDescription,
      }
    );
  },
  mounted() {
    ipcRenderer.on('k8s-integrations', (_, integrations) => {
      this.$data.integrations = integrations;
    });
    ipcRenderer.send('k8s-integrations');
  },
  methods: {
    handleSetIntegration(distro: any, value: any) {
      // TODO: Find out the type for distro and value
      ipcRenderer.send('k8s-integration-set', distro, value);
    },
  }
});
</script>

<template>
  <integration
    v-if="hasIntegration"
    :integrations="integrations"
    :title="integrationTitle"
    @integration-set="handleSetIntegration"
  />
</template>
