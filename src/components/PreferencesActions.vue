<script lang="ts">
import Vue from 'vue';
export default Vue.extend({ name: 'preferences-actions' });
</script>

<template>
  <div class="preferences-actions">
    <button class="btn role-primary">
      Apply
    </button>
    <button class="btn role-secondary">
      Cancel
    </button>
  </div>
</template>

<style lang="scss" scoped>
  .preferences-actions {
    display: flex;
    flex-direction: row-reverse;
    gap: 1rem;
    padding: 0.75rem;
    border-top: 1px solid var(--header-border);
  }
</style>
