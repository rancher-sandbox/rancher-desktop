<script>
import _ from 'lodash';

import RdCheckbox from '@pkg/components/form/RdCheckbox.vue';
import { defaultSettings } from '@pkg/config/settings';
import { ipcRenderer } from '@pkg/utils/ipcRenderer';

/**
 * Rendered in the page title line via the `action` slot, so it has no props
 * and reads the settings it needs itself.
 */
export default {
  name:       'auto-update-checkbox',
  components: { RdCheckbox },
  data() {
    return {
      enabled:    defaultSettings.application.updater.enabled,
      locked:     false,
      /** The updater is unavailable in builds that were not configured for it. */
      configured: false,
    };
  },

  mounted() {
    ipcRenderer.on('settings-update', this.onSettingsUpdate);
    ipcRenderer.on('settings-read', this.onSettingsUpdate);
    ipcRenderer.send('settings-read');
    ipcRenderer.on('update-state', this.onUpdateState);
    ipcRenderer.send('update-state');
    ipcRenderer.invoke('get-locked-fields').then((lockedFields) => {
      this.locked = !!_.get(lockedFields, 'application.updater.enabled');
    });
  },

  beforeUnmount() {
    ipcRenderer.off('settings-update', this.onSettingsUpdate);
    ipcRenderer.off('settings-read', this.onSettingsUpdate);
    ipcRenderer.off('update-state', this.onUpdateState);
  },

  methods: {
    onSettingsUpdate(event, settings) {
      this.enabled = settings.application.updater.enabled;
    },
    onUpdateState(event, state) {
      this.configured = !!state?.configured;
    },
    onChange(value) {
      ipcRenderer.invoke('settings-write', { application: { updater: { enabled: value } } });
    },
  },
};
</script>

<template>
  <rd-checkbox
    v-if="configured"
    :value="enabled"
    :is-locked="locked"
    :label="t('updateStatus.checkForUpdates')"
    @update:value="onChange"
  />
</template>

<style lang="scss" scoped>
// The title line sizes itself to the heading; center the checkbox against it.
.rd-checkbox-container {
  display: flex;
  align-items: center;
  height: 100%;
}
</style>
