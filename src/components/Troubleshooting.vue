<template>
  <div>
    <button @click="factoryReset" :disabled="!canFactoryReset"
            class="role-destructive btn-sm"
            :class="{'btn-disabled': !canFactoryReset}">Factory Reset</button>
    Factory reset will remove all Rancher Desktop configuration.
  </div>
</template>

<script>

const { ipcRenderer } = require('electron');
const K8s = require('../k8s-engine/k8s');

export default {
  name: 'Troubleshooting',
  data: () => ({
    state: ipcRenderer.sendSync('k8s-state'),
  }),
  computed: {
    canFactoryReset() {
      switch (this.state) {
        case K8s.State.STOPPED:
        case K8s.State.STARTED:
        case K8s.State.ERROR:
          return true;
        default:
          return false;
      }
    }
  },
  methods: {
    factoryReset() {
      ipcRenderer.send('factory-reset');
    }
  },
  mounted: function() {
    ipcRenderer.on('k8s-check-state', (event, newState) => {
      this.$data.state = newState;
    });
  }
}
</script>
