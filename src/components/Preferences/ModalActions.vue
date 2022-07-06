<script lang="ts">
import Vue from 'vue';
export default Vue.extend({ name: 'preferences-actions' });
</script>

<template>
  <div class="preferences-actions">
    <button class="btn role-secondary">
      Cancel
    </button>
    <button class="btn role-primary">
      Apply
    </button>
  </div>
</template>

<style lang="scss" scoped>
  .preferences-actions {
    display: flex;
    justify-content: flex-end;
    gap: 1rem;
    padding: var(--preferences-content-padding);
    border-top: 1px solid var(--header-border);
  }
</style>
