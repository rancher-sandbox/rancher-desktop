<template>
  <div>
    <button
      :disabled="!canFactoryReset"
      class="role-destructive btn-sm"
      :class="{'btn-disabled': !canFactoryReset}"
      @click="factoryReset"
    >
      Factory Reset
    </button>
    Factory reset will remove all Rancher Desktop configuration.
  </div>
</template>

<script>

const { ipcRenderer } = require('electron');
const K8s = require('../k8s-engine/k8s');

export default {
  name:  'Troubleshooting',
  title: 'Troubleshooting',
  data:  () => ({
    state: ipcRenderer.sendSync('k8s-state'),
  }),
  computed: {
    canFactoryReset() {
      switch (this.state) {
        case K8s.State.STOPPED:
        case K8s.State.STARTED:
        case K8s.State.READY:
        case K8s.State.ERROR:
          return true;
        default:
          return false;
      }
    },
  },
  mounted() {
    ipcRenderer.on('k8s-check-state', (event, newState) => {
      this.$data.state = newState;
    });
  },
  methods: {
    factoryReset() {
      const message = `
        Doing a factory reset will remove your cluster and all rancher-desktop
        settings; you will need to re-do the initial set up again.  Are you sure
        you want to factory reset?`.replace(/\s+/g, ' ');
      if (confirm(message)) {
        ipcRenderer.send('factory-reset');
      }
    },
  },
};
</script>
