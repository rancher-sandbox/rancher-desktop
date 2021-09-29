<template>
  <section class="dashboard">
    <header>
      <div class="title">
        <h1>Troubleshooting</h1>
      </div>
      <hr>
      <div>
        <span class="description">
          Use these tools to help identify and resolve issues.
        </span>
      </div>
    </header>
    <section class="troubleshooting">
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
        <section class="need-help">
          <hr>
          <span class="description">
            Still having problems? Start a discussion on the <a href="https://slack.rancher.io/">Rancher Users Slack</a> or <a href="https://github.com/rancher-sandbox/rancher-desktop/issues">Report an Issue</a>.
          </span>
        </section>
      </section>
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
    max-width: 56rem;
  }

  .general,
  .kubernetes {
    margin-top: 2rem;
  }

  .title {
    padding-bottom: 0.25rem;
  }

  .btn-xs {
    min-height: 2.25rem;
    max-height: 2.25rem;
    line-height: 0.25rem;
  }

  button.btn-danger {
    color: var(--error) !important;
    border-color: var(--error);
  }

  .description {
    line-height: 0.50rem;
  }

  .need-help {
    margin-top: 2.25rem;
  }
</style>
