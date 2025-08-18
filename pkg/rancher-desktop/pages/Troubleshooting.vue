<template>
  <div class="troubleshooting">
    <div class="troubleshooting-items">
      <troubleshooting-line-item>
        <template #title>
          <span class="text-xl">
            {{ t('troubleshooting.general.logs.title') }}
          </span>
        </template>
        <template #description>
          {{ t('troubleshooting.general.logs.description') }}
        </template>
        <template #actions>
          <button
            data-test="logsButton"
            type="button"
            class="btn btn-xs role-secondary"
            @click="showLogs"
          >
            {{ t('troubleshooting.general.logs.buttonText') }}
          </button>
        </template>
        <template #options>
          <rd-checkbox
            :value="isDebugging"
            :disabled="alwaysDebugging"
            :tooltip="debugModeTooltip"
            :is-locked="debugLocked"
            label="Enable debug mode"
            @update:value="updateDebug"
          />
        </template>
      </troubleshooting-line-item>
      <troubleshooting-line-item>
        <template #title>
          <span class="text-xl">
            {{ t('troubleshooting.kubernetes.resetKubernetes.title') }}
          </span>
        </template>
        <template #description>
          {{ t('troubleshooting.kubernetes.resetKubernetes.description') }}
        </template>
        <template #actions>
          <button
            data-test="k8sResetBtn"
            type="button"
            class="btn btn-xs role-secondary"
            @click="resetKubernetes"
          >
            {{ t('troubleshooting.kubernetes.resetKubernetes.buttonText') }}
          </button>
        </template>
      </troubleshooting-line-item>
      <troubleshooting-line-item>
        <template #title>
          <span class="text-xl">
            {{ t('troubleshooting.general.factoryReset.title') }}
          </span>
        </template>
        <template #description>
          {{ t('troubleshooting.general.factoryReset.description') }}
        </template>
        <template #actions>
          <button
            data-test="factoryResetButton"
            type="button"
            class="btn btn-xs btn-danger role-secondary"
            @click="factoryReset"
          >
            {{ t('troubleshooting.general.factoryReset.buttonText') }}
          </button>
        </template>
      </troubleshooting-line-item>
    </div>
    <div class="need-help">
      <hr>
      <span
        class="description"
        v-html="t('troubleshooting.needHelp', { }, true)"
      />
    </div>
  </div>
</template>

<script>

import _ from 'lodash';

import TroubleshootingLineItem from '@pkg/components/TroubleshootingLineItem.vue';
import RdCheckbox from '@pkg/components/form/RdCheckbox.vue';
import { defaultSettings } from '@pkg/config/settings';
import { ipcRenderer } from '@pkg/utils/ipcRenderer';

export default {
  name:       'Troubleshooting',
  title:      'Troubleshooting',
  components: { TroubleshootingLineItem, RdCheckbox },
  data:       () => ({
    state:           ipcRenderer.sendSync('k8s-state'),
    settings:        defaultSettings,
    debugLocked:     false,
    isDebugging:     false,
    alwaysDebugging: false,
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
      ipcRenderer.send('get-debugging-statuses');
    });
    ipcRenderer.on('settings-update', (_, newSettings) => {
      this.$data.settings = newSettings;
    });
    ipcRenderer.on('is-debugging', (_, status) => {
      this.$data.isDebugging = status;
    });
    ipcRenderer.on('always-debugging', (_, status) => {
      this.$data.alwaysDebugging = status;
    });
    ipcRenderer.send('settings-read');
    ipcRenderer.invoke('get-locked-fields').then((lockedFields) => {
      this.$data.debugLocked = _.get(lockedFields, 'application.debug');
    });
    ipcRenderer.send('get-debugging-statuses');
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
      ipcRenderer.invoke('settings-write', { application: { debug: value } });
      ipcRenderer.send('get-debugging-statuses');
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
  .troubleshooting-items {
    display: flex;
    flex-direction: column;
  }

  .text-xl {
    font-size: 1.25rem;
    line-height: 1.75rem;
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
