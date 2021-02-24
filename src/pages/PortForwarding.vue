<router lang="yaml">
  name: Port Forwarding
</router>
<template>
  <PortForwarding :services="services" />
</template>

<script>
import PortForwarding from '@/components/PortForwarding.vue';
import { ipcRenderer} from 'electron';

export default {
  components: {PortForwarding},
  data() {
    return {
      services: [],
    }
  },

  mounted() {
    ipcRenderer.on('service-changed', (event, services) => {
      this.$data.services = services;
    });
    ipcRenderer.invoke('service-fetch')
      .then((services) => {
        this.$data.services = services;
      });
  }
}
</script>
