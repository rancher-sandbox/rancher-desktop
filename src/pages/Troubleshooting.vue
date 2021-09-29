<template>
  <section class="dashboard">
    <header>
      <div class="title">
        <h1>Troubleshooting</h1>
      </div>
      <hr>
      <div>
        <span>Short explanation about when you might need to use these facilities</span>
      </div>
    </header>
    <section class="kubernetes">
      <h2>Kubernetes</h2>
      <troubleshooting-line-item>
        <template #title>
          Reset Kubernetes
        </template>
        <template #description>
          Resetting Kubernetes will delete workloads and configuration. Use this when...
        </template>
        <button
          type="button"
          class="btn btn-xs role-secondary"
          :disabled="cannotReset"
          @click="showLogs"
        >
          Reset Kubernetes
        </button>
      </troubleshooting-line-item>
      <hr>
      <troubleshooting-line-item>
        <template #title>
          Reset Kubernetes & Container Images
        </template>
        <template #description>
          All images will be lost and Kubernetes will be reset. Use this when...
        </template>
        <button
          type="button"
          class="btn btn-xs role-secondary"
          :disabled="cannotReset"
          @click="factoryReset"
        >
          Reset Container Images
        </button>
      </troubleshooting-line-item>
    </section>
    <section class="general">
      <h2>General</h2>
      <troubleshooting-line-item>
        <template #title>
          Logs
        </template>
        <template #description>
          Show Rancher Desktop logs
        </template>
        <button
          type="button"
          class="btn btn-xs role-secondary"
          @click="showLogs"
        >
          Show Logs
        </button>
      </troubleshooting-line-item>
      <hr>
      <troubleshooting-line-item>
        <template #title>
          Factory Reset
        </template>
        <template #description>
          Factory Reset will remove all Rancher Desktop Configurations. Use this when...
        </template>
        <button
          type="button"
          class="btn btn-xs btn-danger role-secondary"
          :disabled="!canFactoryReset"
          @click="factoryReset"
        >
          Factory Reset
        </button>
      </troubleshooting-line-item>
    </section>
  </section>
</template>

<script>
import TroubleshootingLineItem from '@/components/TroubleshootingLineItem.vue';

const { ipcRenderer } = require('electron');
const K8s = require('../k8s-engine/k8s');

export default {
  name:       'Troubleshooting',
  title:      'Troubleshooting',
  components: { TroubleshootingLineItem },
  data:       () => ({ state: ipcRenderer.sendSync('k8s-state') }),
  computed:   {
    canFactoryReset() {
      switch (this.state) {
      case K8s.State.STOPPED:
      case K8s.State.STARTED:
      case K8s.State.ERROR:
        return true;
      default:
        return false;
      }
    },
    cannotReset() {
      return ![K8s.State.STARTED, K8s.State.ERROR].includes(this.state);
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
    showLogs() {
      console.log('show logs?');
      ipcRenderer.send('troubleshooting/show-logs');
    },
  },
};
</script>

<style lang="scss" scoped>
  .troubleshooting {
    list-style-type: none;
    li {
      margin-bottom: 1em;
    }
  }

  .title {
    padding-bottom: 4px;
  }

  .general,
  .kubernetes {
    max-width: 768px;
    margin-top: 32px;
  }

  .btn-xs {
    min-height: 32px;
    max-height: 32px;
    line-height: 4px;
  }

  button.btn-danger {
    color: var(--error) !important;
    border-color: var(--error);
  }
</style>
