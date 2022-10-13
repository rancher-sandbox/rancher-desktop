<template>
  <div>
    <h2>
      {{ message }}
    </h2>
    <p>
      {{ detail }}
      Please run again as a regular user.
    </p>
    <div class="button-area">
      <button
        data-test="accept-btn"
        class="role-primary"
        @click="close"
      >
        OK
      </button>
    </div>
  </div>
</template>

<script lang="ts">
import os from 'os';

import { ipcRenderer } from 'electron';
import Vue from 'vue';

export default Vue.extend({
  layout:   'dialog',
  computed: {
    isUnix(): boolean {
      return ['linux', 'darwin'].includes(os.platform());
    },
    message(): string {
      return `Cannot Run as ${ this.isUnix ? 'Root' : 'Administrator' }`;
    },
    detail(): string {
      return `Rancher Desktop cannot be run ${ this.isUnix ? 'with root privileges' : 'as administrator' }.`;
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

<style lang="scss" scoped>
  .button-area {
    align-self: flex-end;
  }
</style>
