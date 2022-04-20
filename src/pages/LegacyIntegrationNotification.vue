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
    close() {
      window.close();
    }
  },
});
</script>

<template>
  <div>
    <h3>
      {{ t('legacyIntegrations.title') }}
      <i v-tooltip="t('legacyIntegrations.tooltip')" class="icon icon-info icon-lg" />
    </h3>
    <p>
      {{ t('legacyIntegrations.messageFirstPart') }}
      <code>{{ oldIntegrationPath }}</code>
      {{ t('legacyIntegrations.messageSecondPart') }}
    </p>
    <p>
      {{ t('legacyIntegrations.messageThirdPart') }}
    </p>
    <div class="button-area">
      <button
        data-test="accept-btn"
        class="role-primary"
        @click="close"
      >
        {{ t('legacyIntegrations.ok') }}
      </button>
    </div>
  </div>
</template>

<style lang="scss" scoped>
  .button-area {
    align-self: flex-end;
  }
  code {
    user-select: text;
    cursor: text;
    padding: 2px;
  }
</style>
