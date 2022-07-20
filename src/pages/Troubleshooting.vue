<template>
  <section class="dashboard">
    <section class="troubleshooting">
      <section class="general">
        <troubleshooting-line-item>
          <template #title>
            {{ t('troubleshooting.general.logs.title') }}
          </template>
          <template #description>
            {{ t('troubleshooting.general.logs.description') }}
          </template>
          <button
            data-test="logsButton"
            type="button"
            class="btn btn-xs role-secondary"
            @click="showLogs"
          >
            {{ t('troubleshooting.general.logs.buttonText') }}
          </button>
          <template #options>
            <Checkbox
              :value="settings.debug"
              label="Enable debug mode"
              @input="updateDebug"
            />
          </template>
        </troubleshooting-line-item>
        <hr>
        <troubleshooting-line-item>
          <template #title>
            {{ t('troubleshooting.kubernetes.resetKubernetes.title') }}
          </template>
          <template #description>
            {{ t('troubleshooting.kubernetes.resetKubernetes.description') }}
          </template>
          <button
            data-test="k8sResetBtn"
            type="button"
            class="btn btn-xs role-secondary"
            @click="resetKubernetes"
          >
            {{ t('troubleshooting.kubernetes.resetKubernetes.buttonText') }}
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
        </troubleshooting-line-item>
        <div class="factory-reset-button-wrapper">
          <split-button
            class="role-secondary btn-reset"
            data-test="factoryResetButton"
            label="Factory Reset"
            value="auto"
            :options="[{id: 'keepImages', label: 'Keep cached Kubernetes images'}]"
            @input="factoryReset"
          />
        </div>
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
import Checkbox from '@/components/form/Checkbox';
import SplitButton from '@/components/form/SplitButton.vue';
import { defaultSettings } from '@/config/settings';

const { ipcRenderer } = require('electron');
const K8s = require('../k8s-engine/k8s');

export default {
  name:       'Troubleshooting',
  title:      'Troubleshooting',
  components: {
    TroubleshootingLineItem, Checkbox, SplitButton
  },
  data:       () => ({
    state:    ipcRenderer.sendSync('k8s-state'),
    settings: defaultSettings,
  }),
  mounted() {
    this.$store.dispatch(
      'page/setHeader',
      { title: this.t('troubleshooting.title') }
    );
    ipcRenderer.on('k8s-check-state', (_, newState) => {
      this.$data.state = newState;
    });
    ipcRenderer.on('settings-read', (_, settings) => {
      this.$data.settings = settings;
    });
    ipcRenderer.on('settings-update', (_, newSettings) => {
      this.$data.settings = newSettings;
    });
    ipcRenderer.send('settings-read');
  },
  methods: {
    factoryReset(mode) {
      const message = `Doing a factory reset will remove your cluster and
        all Rancher Desktop settings, and shut down Rancher Desktop. If you
        intend to continue using Rancher Desktop, you will need to manually
        start it and go through the initial set up again. Are you sure you
        want to factory reset?`.replace(/\s+/g, ' ');

      if (confirm(message)) {
        ipcRenderer.send('factory-reset', mode === 'keepImages');
      }
    },
    showLogs() {
      ipcRenderer.send('troubleshooting/show-logs');
    },
    updateDebug(value) {
      ipcRenderer.invoke('settings-write', { debug: value });
    },
    async resetKubernetes() {
      const cancelPosition = 1;
      const message = this.t('troubleshooting.kubernetes.resetKubernetes.messageBox.message');
      const detail = this.t('troubleshooting.kubernetes.resetKubernetes.description');

      const confirm = await ipcRenderer.invoke(
        'show-message-box',
        {
          message,
          detail,
          type:            'question',
          title:           this.t('troubleshooting.kubernetes.resetKubernetes.messageBox.title'),
          checkboxLabel:   this.t('troubleshooting.kubernetes.resetKubernetes.messageBox.checkboxLabel'),
          checkboxChecked: false,
          buttons:         [
            this.t('troubleshooting.kubernetes.resetKubernetes.messageBox.ok'),
            this.t('troubleshooting.kubernetes.resetKubernetes.messageBox.cancel')
          ],
          cancelId: cancelPosition
        },
        true
      );

      const { response, checkboxChecked } = confirm;

      if (response === cancelPosition) {
        return;
      }

      ipcRenderer.send('k8s-reset', checkboxChecked ? 'wipe' : 'fast');
    }
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
</style>
