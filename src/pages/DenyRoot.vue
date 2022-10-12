<template>
  <div>
    <h2 v-if="isUnix">Cannot Run As Root</h2>
    <h2 v-else>Cannot Run As Administrator</h2>
    <p v-if="isUnix">
      Rancher Desktop cannot be run with root privileges.
      Please run again as a regular user.
    </p>
    <p v-else>
      Rancher Desktop cannot be run as administrator.
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
