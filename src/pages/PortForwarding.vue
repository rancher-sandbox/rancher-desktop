<router lang="yaml">
  name: Port Forwarding
</router>
<template>
  <PortForwarding
    class="content"
    :services="services"
    :include-kubernetes-services="settings.portForwarding.includeKubernetesServices"
    :k8s-state="state"
    :kubernetes-is-disabled="!settings.kubernetes.enabled"
    :serviceBeingEdited="serviceBeingEdited"
    :errorMessage="errorMessage"
    @toggledServiceFilter="onIncludeK8sServicesChanged"
    @editPortForward="handleEditPortForward"
    @cancelPortForward="handleCancelPortForward"
    @cancelEditPortForward="handleCancelEditPortForward"
    @updatePortForward="handleUpdatePortForward"
  />
</template>

<script lang="ts">
import { ipcRenderer } from 'electron';
import PortForwarding from '@/components/PortForwarding.vue';
import { defaultSettings } from '@/config/settings';
import Vue from 'vue';
import * as K8s from '@/k8s-engine/k8s';
import { Settings } from '@/config/settings';

export default Vue.extend({
  components: { PortForwarding },
  data() {
    return {
      state:         ipcRenderer.sendSync('k8s-state'),
      settings: defaultSettings as Settings,
      services: [] as K8s.ServiceEntry[],
      errorMessage: null as string | null,
      serviceBeingEdited: null as K8s.ServiceEntry | null,
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
    ipcRenderer.on('service-error', (event, errorMessage) => {
      this.$data.errorMessage = errorMessage;
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
    onIncludeK8sServicesChanged(value: boolean) {
      if (value !== this.settings.portForwarding.includeKubernetesServices) {
        ipcRenderer.invoke('settings-write',
          { portForwarding: { includeKubernetesServices: value } } );
      }
    },
    serviceBeingEditedIs(service: K8s.ServiceEntry): boolean {
      if (this.serviceBeingEdited === null) {
        return false;
      }

      // compare the two services, minus listenPort property, since this may differ
      return this.serviceBeingEdited.name === service.name &&
        this.serviceBeingEdited.namespace === service.namespace &&
        this.serviceBeingEdited.port === service.port;
    },
    handleEditPortForward(service: K8s.ServiceEntry) {
      this.errorMessage = null;
      if (this.serviceBeingEdited) {
        ipcRenderer.invoke('service-forward', this.serviceBeingEdited, false);
      }
      this.serviceBeingEdited = Object.assign({}, service);
      // Forward ServiceEntry without listenPort set to get random port.
      // The user can change this after we get a random port.
      ipcRenderer.invoke('service-forward', service, true);
    },
    handleCancelEditPortForward(service: K8s.ServiceEntry) {
      this.errorMessage = null;
      ipcRenderer.invoke('service-forward', service, false);
      this.serviceBeingEdited = null;
    },
    handleCancelPortForward(service: K8s.ServiceEntry) {
      this.errorMessage = null;
      ipcRenderer.invoke('service-forward', service, false);
    },
    handleUpdatePortForward(service: K8s.ServiceEntry) {
      this.errorMessage = null;
      ipcRenderer.invoke('service-forward', service, true);
      this.serviceBeingEdited = null;
    },
  },

  watch: {
    services(newServices: K8s.ServiceEntry[]) {
      console.log(`watch services newServices: ${ JSON.stringify(newServices) }`);
      console.log(`watch services this.serviceBeingEdited before: ${ JSON.stringify(this.serviceBeingEdited) }`);
      const service = newServices.find(service => this.serviceBeingEditedIs(service));
      if (service && this.serviceBeingEdited) {
        this.serviceBeingEdited = Object.assign(this.serviceBeingEdited, {listenPort: service.listenPort});
      }
      console.log(`watch services this.serviceBeingEdited after: ${ JSON.stringify(this.serviceBeingEdited) }`);
    }
  }
});
</script>

<style scoped>
  .content {
    padding: 20px;
  }
</style>
