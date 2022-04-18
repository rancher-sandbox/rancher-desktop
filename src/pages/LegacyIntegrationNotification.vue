<script lang="ts">
import Vue from 'vue';
import { ipcRenderer } from 'electron';
import paths from '@/utils/paths';

export default Vue.extend({
  layout:     'dialog',
  computed: {
    oldIntegrationPath() {
      return paths.oldIntegration;
    },
  },
  mounted() {
    ipcRenderer.send('dialog/ready');
  },
  methods: {
    async close() {
      window.close();
    }
  },
});
</script>

<template>
  <div>
    <h3>{{ t('app.name') }}</h3>
    <p>
      Rancher Desktop detected legacy tool symlinks in {{ oldIntegrationPath }},
      but did not have the required permissions to remove them. Please remove
      them at your earliest convenience.
    </p>
    <div class="button-area">
      <button
        data-test="accept-btn"
        class="role-primary"
        @click="close"
      >
        Ok
      </button>
    </div>
  </div>
</template>

<style lang="scss" scoped>
  .button-area {
    align-self: flex-end;
  }
</style>
