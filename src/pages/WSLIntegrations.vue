<router lang="yaml">
  name: WSL Integrations
</router>

<script lang="ts">
import { ipcRenderer } from 'electron';
import Vue from 'vue';
import WSLIntegration from '@/components/WSLIntegration.vue';

export default Vue.extend({
  components: { 'wsl-integration': WSLIntegration },
  data() {
    return { integrations: {} as Record<string, boolean | string> };
  },
  computed:   {
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
    handleSetIntegration(distro: string, value: boolean) {
      ipcRenderer.send('k8s-integration-set', distro, value);
    },
  }
});
</script>

<template>
  <wsl-integration
    :integrations="integrations"
    :title="integrationTitle"
    @integration-set="handleSetIntegration"
  />
</template>
