<template>
  <div>
    <h2 v-if="isUnix">
      Rancher Desktop cannot be run with root privileges.
    </h2>
    <h2 v-else>
      Rancher Desktop cannot be run as administrator.
    </h2>
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

<script lang="ts">
import os from 'os';
import Vue from 'vue';

export default Vue.extend({
  layout: 'dialog',
  computed: {
    isUnix(): boolean {
      return ['linux', 'darwin'].includes(os.platform());
    }
  },
  methods:{
    close() {
      window.close();
    },
  }
});
</script>

<style lang="scss" scoped>
  .button-area {
    align-self: flex-end;
  }
</style>
