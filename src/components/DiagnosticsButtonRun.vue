<script lang="ts">
import Vue from 'vue';
export default Vue.extend({ name: 'diagnostics-button-run' });
</script>

<template>
  <div class="diagnostics-actions">
    <button class="btn btn-xs role-secondary">
      <span class="icon icon-refresh icon-diagnostics"></span>
      Rerun
    </button>
  </div>
</template>

<style lang="scss" scoped>
  .diagnostics-actions {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 0.5rem;
  }

  .btn-xs {
    min-height: 2.25rem;
    max-height: 2.25rem;
    line-height: 0.25rem;
  }

  .icon-diagnostics {
    padding-right: 0.25rem;
  }
</style>
