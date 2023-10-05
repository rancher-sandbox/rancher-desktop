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
    :service-being-edited="serviceBeingEdited"
    :error-message="errorMessage"
    @updatePort="handleUpdatePort"
    @toggledServiceFilter="onIncludeK8sServicesChanged"
    @editPortForward="handleEditPortForward"
    @cancelPortForward="handleCancelPortForward"
    @cancelEditPortForward="handleCancelEditPortForward"
    @updatePortForward="handleUpdatePortForward"
    @closeError="handleCloseError"
  />
</template>

<script lang="ts">

import Vue from 'vue';

import type { ServiceEntry } from '@pkg/backend/k8s';
import PortForwarding from '@pkg/components/PortForwarding.vue';
import { defaultSettings, Settings } from '@pkg/config/settings';
import { ipcRenderer } from '@pkg/utils/ipcRenderer';

export default Vue.extend({
  components: { PortForwarding },
  data() {
    return {
      state:              ipcRenderer.sendSync('k8s-state'),
      settings:           defaultSettings as Settings,
      services:           [] as ServiceEntry[],
      errorMessage:       null as string | null,
      serviceBeingEdited: null as ServiceEntry | null,
    };
  },

  watch: {
    services(newServices: ServiceEntry[]): void {
      if (this.serviceBeingEdited) {
        const newService = newServices.find(service => this.compareServices(this.serviceBeingEdited as ServiceEntry, service));

        if (newService) {
          this.serviceBeingEdited = Object.assign(this.serviceBeingEdited, { listenPort: newService.listenPort });
        }
      }
    },
  },

  mounted() {
    this.$store.dispatch(
      'page/setHeader',
      { title: this.t('portForwarding.title') },
    );
    ipcRenderer.on('k8s-check-state', (event, state) => {
      this.$data.state = state;
    });
    ipcRenderer.on('service-changed', (event, services) => {
      this.$data.services = services;
    });
    ipcRenderer.on('service-error', (event, problemService, errorMessage) => {
      ipcRenderer.invoke('service-forward', problemService, false);
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
    handleUpdatePort(newPort: number): void {
      if (this.serviceBeingEdited) {
        this.serviceBeingEdited.listenPort = newPort;
      }
    },

    onIncludeK8sServicesChanged(value: boolean): void {
      if (value !== this.settings.portForwarding.includeKubernetesServices) {
        ipcRenderer.invoke('settings-write',
          { portForwarding: { includeKubernetesServices: value } } );
      }
    },

    compareServices(service1: ServiceEntry, service2: ServiceEntry): boolean {
      return service1.name === service2.name &&
        service1.namespace === service2.namespace &&
        service1.port === service2.port;
    },

    findServiceMatching(serviceToMatch: ServiceEntry | undefined, serviceList: ServiceEntry[]): ServiceEntry | undefined {
      if (!serviceToMatch) {
        return undefined;
      }
      const compareServices = (service1: ServiceEntry, service2: ServiceEntry) => {
        return service1.name === service2.name &&
          service1.namespace === service2.namespace &&
          service1.port === service2.port;
      };

      return serviceList.find(service => compareServices(service, serviceToMatch));
    },

    handleEditPortForward(service: ServiceEntry): void {
      this.errorMessage = null;
      if (this.serviceBeingEdited) {
        ipcRenderer.invoke('service-forward', this.serviceBeingEdited, false);
      }
      this.serviceBeingEdited = Object.assign({}, service);
      // Forward ServiceEntry without listenPort set to get random port.
      // The user can change this after we get a random port.
      ipcRenderer.invoke('service-forward', service, true);
    },

    handleCancelEditPortForward(service: ServiceEntry): void {
      this.errorMessage = null;
      ipcRenderer.invoke('service-forward', service, false);
      this.serviceBeingEdited = null;
    },

    handleCancelPortForward(service: ServiceEntry): void {
      this.errorMessage = null;
      ipcRenderer.invoke('service-forward', service, false);
    },

    handleUpdatePortForward(): void {
      this.errorMessage = null;
      if (this.serviceBeingEdited) {
        ipcRenderer.invoke('service-forward', this.serviceBeingEdited, true);
      }
      this.serviceBeingEdited = null;
    },

    handleCloseError(): void {
      this.errorMessage = null;
    },
  },
});
</script>

<style scoped>
  .content {
    padding-top: 13px;
  }
</style>
