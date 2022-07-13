<script lang="ts">
import Vue from 'vue';
export default Vue.extend({ name: 'empty-state' });
</script>

<template>
  <div class="empty-state">
    <div class="empty-state-icon">
      <slot name="icon">
        <span class="icon icon-alert"></span>
      </slot>
    </div>
    <div class="empty-state-heading">
      <slot name="heading">
        NOT FAIL
      </slot>
    </div>
    <div class="empty-state-body">
      <slot name="body">
        This is some body text that we want to relay to the end user
      </slot>
    </div>
  </div>
</template>

<style lang="scss" scoped>
  .empty-state {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    align-items: center;
  }

  .empty-state-icon {
    font-size: 8rem;
    line-height: 1;
  }

  .empty-state-heading {
    font-size: 1.875rem;
    line-height: 2.25rem;
  }

  .empty-state-body {
    font-size: 1rem;
    line-height: 1.5rem;
  }
</style>
