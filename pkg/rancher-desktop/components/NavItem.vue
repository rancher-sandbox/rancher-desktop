<script lang="ts">
import Vue from 'vue';
export default Vue.extend({});
</script>

<template>
  <div class="nav-item">
    <slot name="before">
    </slot>
    <slot name="default">
      Extensions
    </slot>
    <slot name="after"></slot>
  </div>
</template>

<style scoped lang="scss">
  .nav-item {
    color: var(--body-text);
    text-decoration: none;
    line-height: 24px;
    padding: 7.5px 10px;
    letter-spacing: 1.4px;
    display: flex;
    gap: 0.25rem;
    align-items: center;
  }
</style>
