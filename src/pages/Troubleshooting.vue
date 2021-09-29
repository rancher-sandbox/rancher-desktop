<template>
  <section class="dashboard">
    <header>
      <div class="title">
        <h1>{{ t('troubleshooting.title') }}</h1>
      </div>
      <hr>
      <span class="description">
        {{ t('troubleshooting.description') }}
      </span>
    </header>
    <section class="troubleshooting">
      <section class="kubernetes">
        <h2>{{ t('troubleshooting.kubernetes.title') }}</h2>
        <troubleshooting-line-item>
          <template #title>
            {{ t('troubleshooting.kubernetes.resetKubernetes.title') }}
          </template>
          <template #description>
            {{ t('troubleshooting.kubernetes.resetKubernetes.description') }}
          </template>
          <button
            type="button"
            class="btn btn-xs role-secondary"
            :disabled="cannotReset"
            @click="showLogs"
          >
            {{ t('troubleshooting.kubernetes.resetKubernetes.buttonText') }}
          </button>
        </troubleshooting-line-item>
        <hr>
        <troubleshooting-line-item>
          <template #title>
            {{ t('troubleshooting.kubernetes.resetContainer.title') }}
          </template>
          <template #description>
            {{ t('troubleshooting.kubernetes.resetContainer.description') }}
          </template>
          <button
            type="button"
            class="btn btn-xs role-secondary"
            :disabled="cannotReset"
            @click="factoryReset"
          >
            {{ t('troubleshooting.kubernetes.resetContainer.buttonText') }}
          </button>
        </troubleshooting-line-item>
      </section>
      <section class="general">
        <h2>{{ t('troubleshooting.general.title') }}</h2>
        <troubleshooting-line-item>
          <template #title>
            {{ t('troubleshooting.general.logs.title') }}
          </template>
          <template #description>
            {{ t('troubleshooting.general.logs.description') }}
          </template>
          <button
            type="button"
            class="btn btn-xs role-secondary"
            @click="showLogs"
          >
            {{ t('troubleshooting.general.logs.buttonText') }}
          </button>
        </troubleshooting-line-item>
        <hr>
        <troubleshooting-line-item>
          <template #title>
            {{ t('troubleshooting.general.factoryReset.title') }}
          </template>
          <template #description>
            {{ t('troubleshooting.general.factoryReset.description') }}
          </template>
          <button
            type="button"
            class="btn btn-xs btn-danger role-secondary"
            :disabled="!canFactoryReset"
            @click="factoryReset"
          >
            {{ t('troubleshooting.general.factoryReset.buttonText') }}
          </button>
        </troubleshooting-line-item>
        <section class="need-help">
          <hr>
          <span
            class="description"
            v-html="t('troubleshooting.needHelp', { }, true)"
          />
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
