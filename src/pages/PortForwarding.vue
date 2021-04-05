<router lang="yaml">
  name: Port Forwarding
</router>
<template>
  <PortForwarding
    class="content"
    :services="services"
    :include-kubernetes-services="settings.portForwarding.includeKubernetesServices"
    @change="onIncludeK8sServicesChanged"
  />
</template>

<script>
import PortForwarding from '@/components/PortForwarding.vue';
import { ipcRenderer } from 'electron';

/** @typedef { import("../config/settings").Settings } Settings */

export default {
  components: { PortForwarding },
  data() {
    return {
      /** @type Settings */
      settings:      ipcRenderer.sendSync('settings-read'),
      services: []
    };
  },

  mounted() {
    ipcRenderer.on('service-changed', (event, services) => {
      this.$data.services = services;
    });
    ipcRenderer.invoke('service-fetch')
      .then((services) => {
        this.$data.services = services;
      });
    ipcRenderer.on('settings-update', (event, settings) => {
      // TODO: put in a status bar
      this.$data.settings = settings;
    });
  },

  methods: {
    onIncludeK8sServicesChanged(value) {
      if (value !== this.settings.portForwarding.includeKubernetesServices) {
        ipcRenderer.invoke('settings-write',
          { portForwarding: { includeKubernetesServices: value } } );
      }
    },
  },
};
</script>

<style scoped>
  .content {
    padding: 20px;
  }
</style>
