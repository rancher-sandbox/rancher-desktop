<template>
  <div>
    <h2>{{ t('Required.title') }}</h2>
    <h3>{{ t('Required.message') }}</h3>
    <p>{{ reason }}</p>
    <div class="button-area">
      <button data-test="accept-btn" class="role-primary" @click="close">
        {{ t('Required.buttonText') }}
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
    // ipcRenderer.send('dialog/ready');  // delete this
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
    window.addEventListener('close', () => {
      ipcRenderer.send('required-prompt/closed', this.suppress);
    });
    (this.$refs.accept as HTMLButtonElement)?.focus();
  },
  methods: {
    close() {
      ipcRenderer.send('required-prompt/closed', this.suppress);
      window.close();
    },
  },
});
</script>

<style lang="scss" scoped>
  .button-area {
    align-self: flex-end;
  }
</style>
