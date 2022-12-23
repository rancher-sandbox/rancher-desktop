<template>
  <div class="container">
    <h2>{{ t('unmetPrerequisites.title') }}</h2>
    <p>{{ t('unmetPrerequisites.message') }}</p>
    <ul>
      <li>{{ reason }}</li>
    </ul>
    <p>{{ t('unmetPrerequisites.action') }}</p>
    <div class="button-area">
      <button data-test="accept-btn" class="role-primary" @click="close">
        {{ t('unmetPrerequisites.buttonText') }}
      </button>
    </div>
  </div>
</template>

<script lang="ts">
import { ipcRenderer } from 'electron';
import Vue from 'vue';

export default Vue.extend({
  layout: 'dialog',
  data() {
    return {
      reason:   '',
      suppress: false,
    };
  },
  mounted() {
    ipcRenderer.on('dialog/populate', (event, reasonId) => {
      switch (reasonId) {
      case 'win32-release':
        this.$data.reason = 'Requires Windows version 10-1909 or newer';
        break;
      case 'macOS-release':
        this.$data.reason = 'Requires MacOS version 10.15 or newer';
        break;
      case 'linux-nested':
        this.$data.reason = 'Nested virtualization not enabled on this host';
        break;
      }
    });
  },
  methods: {
    close() {
      window.close();
    },
  },
});
</script>

<style lang="scss" scoped>
  .container {
    min-width: 30rem;
  }
  .button-area {
    align-self: flex-end;
  }
</style>
