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
    @updatePort="handleUpdatePort"
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
      serviceBeingEdited: undefined as K8s.ServiceEntry | undefined,
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

    compareServices(service1: K8s.ServiceEntry, service2: K8s.ServiceEntry): boolean {
      return service1.name === service2.name &&
        service1.namespace === service2.namespace &&
        service1.port === service2.port;
    },

    findServiceMatching(serviceToMatch: K8s.ServiceEntry | undefined, serviceList: K8s.ServiceEntry[]): K8s.ServiceEntry | undefined {
      if (!serviceToMatch) {
        return undefined;
      }
      const compareServices = (service1: K8s.ServiceEntry, service2: K8s.ServiceEntry) => {
        return service1.name === service2.name &&
          service1.namespace === service2.namespace &&
          service1.port === service2.port;
      }
      return serviceList.find(service => compareServices(service, serviceToMatch));
    },

    handleEditPortForward(service: K8s.ServiceEntry): void {
      this.errorMessage = null;
      if (this.serviceBeingEdited) {
        ipcRenderer.invoke('service-forward', this.serviceBeingEdited, false);
      }
      this.serviceBeingEdited = Object.assign({}, service);
      // Forward ServiceEntry without listenPort set to get random port.
      // The user can change this after we get a random port.
      ipcRenderer.invoke('service-forward', service, true);
    },

    handleCancelEditPortForward(service: K8s.ServiceEntry): void {
      this.errorMessage = null;
      ipcRenderer.invoke('service-forward', service, false);
      this.serviceBeingEdited = undefined;
    },

    handleCancelPortForward(service: K8s.ServiceEntry): void {
      this.errorMessage = null;
      ipcRenderer.invoke('service-forward', service, false);
    },

    handleUpdatePortForward(): void {
      this.errorMessage = null;
      ipcRenderer.invoke('service-forward', this.serviceBeingEdited, true);
      this.serviceBeingEdited = undefined;
    },
  },

  watch: {
    services(newServices: K8s.ServiceEntry[]): void {
      if (this.serviceBeingEdited) {
        const newService = newServices.find(service => this.compareServices(this.serviceBeingEdited!, service));
        if (newService) {
          this.serviceBeingEdited = Object.assign(this.serviceBeingEdited, {listenPort: newService.listenPort});
        }
      }
    }
  }
});
</script>

<style scoped>
  .content {
    padding: 20px;
  }
</style>
