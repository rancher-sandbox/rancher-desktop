<script lang="ts">
import Vue from 'vue';

import { ipcRenderer } from '@pkg/utils/ipcRenderer';
import paths from '@pkg/utils/paths';

export default Vue.extend({
  layout:   'dialog',
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
    },
  },
});
</script>

<template>
  <div class="container">
    <h3>{{ t('legacyIntegrations.title') }}</h3>
    <p>
      {{ t('legacyIntegrations.messageFirstPart') }}
      <code>{{ oldIntegrationPath }}</code>
      {{ t('legacyIntegrations.messageSecondPart') }}
    </p>
    <p>
      {{ t('legacyIntegrations.messageThirdPart') }}
    </p>
    <details>
      <summary>More Info</summary>
      <br>
      <p>{{ t('legacyIntegrations.details') }}</p>
    </details>
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
  .container {
    min-width: 32rem;
  }

  .button-area {
    align-self: flex-end;
  }

  summary {
    user-select: none;
    cursor: pointer;
  }

  code {
    user-select: text;
    cursor: text;
    padding: 2px;
  }
</style>
