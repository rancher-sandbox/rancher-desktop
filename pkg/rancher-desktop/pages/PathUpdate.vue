<script lang="ts">
import Vue from 'vue';
import { mapGetters } from 'vuex';

import PathManagementSelector from '@pkg/components/PathManagementSelector.vue';
import type { Settings } from '@pkg/config/settings';
import { PathManagementStrategy } from '@pkg/integrations/pathManager';
import { ipcRenderer } from '@pkg/utils/ipcRenderer';

export default Vue.extend({
  name:       'path-update',
  components: { PathManagementSelector },
  layout:     'dialog',
  fetch() {
    ipcRenderer.once('settings-read', (_event, settings) => {
      this.onSettingsUpdate(settings);
    });
    ipcRenderer.on('settings-update', (_event, settings) => {
      this.onSettingsUpdate(settings);
    });
    ipcRenderer.send('settings-read');
  },
  computed: { ...mapGetters('applicationSettings', ['pathManagementStrategy']) },
  beforeMount() {
    window.addEventListener('beforeunload', this.commitStrategy);
    if (this.pathManagementStrategy === PathManagementStrategy.NotSet) {
      this.setPathManagementStrategy(PathManagementStrategy.RcFiles);
    }
  },
  mounted() {
    ipcRenderer.send('dialog/ready');
  },
  beforeDestroy() {
    window.removeEventListener('beforeunload', this.commitStrategy);
  },
  methods: {
    setPathManagementStrategy(val: PathManagementStrategy) {
      this.$store.dispatch('applicationSettings/setPathManagementStrategy', val);
    },
    async commitStrategy() {
      await this.$store.dispatch('applicationSettings/commitPathManagementStrategy', this.pathManagementStrategy as PathManagementStrategy);
      window.close();
    },
    onSettingsUpdate(settings: Settings) {
      this.$store.dispatch('applicationSettings/setSudoAllowed', !settings.kubernetes.suppressSudo);
    },
  },
});
</script>

<template>
  <div>
    <h3>{{ t('app.name') }}</h3>
    <div>{{ t('app.update', { }, true) }}</div>
    <path-management-selector
      :value="pathManagementStrategy"
      @input="setPathManagementStrategy"
    />
    <div class="button-area">
      <button
        data-test="accept-btn"
        class="role-primary"
        @click="commitStrategy"
      >
        {{ t('pathManagement.accept') }}
      </button>
    </div>
  </div>
</template>

<style lang="scss" scoped>
  .button-area {
    align-self: flex-end;
  }
</style>
