<script lang="ts">
import Vue from 'vue';
export default Vue.extend({ name: 'DiagnosticsBody' });
</script>

<template>
  <div class="diagnostics-status">
    <div class="item-results">
      6 failed (0 muted) Hide muted
    </div>
    <div class="diagnostics-status-history">
      Last run: 52 minutes ago
    </div>
  </div>
</template>

<style lang="scss" scoped>
  .diagnostics-status {
    display: flex;

    .item-results {
      flex: 1;
    }
  }
</style>
