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
              :value="isDebugging"
              :disabled="alwaysDebugging"
              :tooltip="debugModeTooltip"
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
          <button
            data-test="factoryResetButton"
            type="button"
            class="btn btn-xs btn-danger role-secondary"
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

import { Checkbox } from '@rancher/components';

import TroubleshootingLineItem from '@pkg/components/TroubleshootingLineItem.vue';
import { defaultSettings, runInDebugMode } from '@pkg/config/settings';

const { ipcRenderer } = require('electron');

export default {
  name:       'Troubleshooting',
  title:      'Troubleshooting',
  components: { TroubleshootingLineItem, Checkbox },
  data:       () => ({
    state:           ipcRenderer.sendSync('k8s-state'),
    settings:        defaultSettings,
    isDebugging:     runInDebugMode(defaultSettings.debug),
    alwaysDebugging: runInDebugMode(false),
  }),
  computed: {
    debugModeTooltip() {
      return this.alwaysDebugging ? 'Cannot be modified because the RD_DEBUG_ENABLED environment variable is set.' : '';
    },
  },
  mounted() {
    this.$store.dispatch(
      'page/setHeader',
      { title: this.t('troubleshooting.title') },
    );
    ipcRenderer.on('k8s-check-state', (_, newState) => {
      this.$data.state = newState;
    });
    ipcRenderer.on('settings-read', (_, newSettings) => {
      this.$data.settings = newSettings;
      this.$data.isDebugging = runInDebugMode(newSettings.debug);
    });
    ipcRenderer.on('settings-update', (_, newSettings) => {
      this.$data.settings = newSettings;
    });
    ipcRenderer.send('settings-read');
  },
  methods: {
    async factoryReset() {
      const cancelPosition = 1;
      const message = this.t('troubleshooting.general.factoryReset.messageBox.message');
      const detail = this.t('troubleshooting.general.factoryReset.messageBox.detail', { }, true);

      const confirm = await ipcRenderer.invoke(
        'show-message-box-rd',
        {
          message,
          detail,
          type:            'question',
          title:           this.t('troubleshooting.general.factoryReset.messageBox.title'),
          checkboxLabel:   this.t('troubleshooting.general.factoryReset.messageBox.checkboxLabel'),
          checkboxChecked: false,
          buttons:         [
            this.t('troubleshooting.general.factoryReset.messageBox.ok'),
            this.t('troubleshooting.general.factoryReset.messageBox.cancel'),
          ],
          cancelId: cancelPosition,
        },
        true,
      );

      const { response, checkboxChecked: keepImages } = confirm;

      if (response === cancelPosition) {
        return;
      }

      ipcRenderer.send('factory-reset', keepImages);
    },
    showLogs() {
      ipcRenderer.send('show-logs');
    },
    updateDebug(value) {
      this.$data.isDebugging = runInDebugMode(value);
      ipcRenderer.invoke('settings-write', { debug: value });
    },
    async resetKubernetes() {
      const cancelPosition = 1;
      const message = this.t('troubleshooting.kubernetes.resetKubernetes.messageBox.message');
      const detail = this.t('troubleshooting.kubernetes.resetKubernetes.description');

      const confirm = await ipcRenderer.invoke(
        'show-message-box-rd',
        {
          message,
          detail,
          type:            'question',
          title:           this.t('troubleshooting.kubernetes.resetKubernetes.messageBox.title'),
          checkboxLabel:   this.t('troubleshooting.kubernetes.resetKubernetes.messageBox.checkboxLabel'),
          checkboxChecked: false,
          buttons:         [
            this.t('troubleshooting.kubernetes.resetKubernetes.messageBox.ok'),
            this.t('troubleshooting.kubernetes.resetKubernetes.messageBox.cancel'),
          ],
          cancelId: cancelPosition,
        },
        true,
      );

      const { response, checkboxChecked } = confirm;

      if (response === cancelPosition) {
        return;
      }

      ipcRenderer.send('k8s-reset', checkboxChecked ? 'wipe' : 'fast');
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
</style>
