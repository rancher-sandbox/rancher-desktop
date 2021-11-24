<router lang="yaml">
  name: Port Forwarding
</router>
<template>
  <PortForwarding
    class="content"
    :services="services"
    :include-kubernetes-services="settings.portForwarding.includeKubernetesServices"
    :k8s-state="state"
    @toggledServiceFilter="onIncludeK8sServicesChanged"
  />
</template>

<script>
import PortForwarding from '@/components/PortForwarding.vue';
import { ipcRenderer } from 'electron';
import { defaultSettings } from '@/config/settings';

/** @typedef { import("../config/settings").Settings } Settings */

export default {
  components: { PortForwarding },
  data() {
    return {
      state:         ipcRenderer.sendSync('k8s-state'),
      /** @type Settings */
      settings:      defaultSettings,
      services: []
    };
  },

  mounted() {
    this.$store.dispatch(
      'page/setHeader',
      { title: this.t('portForwarding.title') }
    );
    ipcRenderer.on('k8s-check-state', (event, state) => {
      this.$data.state = state;
    });
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
    ipcRenderer.on('settings-read', (event, settings) => {
      this.$data.settings = settings;
    });
    ipcRenderer.send('settings-read');
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
