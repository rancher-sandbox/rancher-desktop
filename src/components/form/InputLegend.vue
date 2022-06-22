<script lang="ts">
import Vue from 'vue';
export default Vue.extend({ name: 'input-legend' });
</script>

<template>
  <div>
    <div class="input-legend">
      <slot name="legend"></slot>
    </div>
    <slot></slot>
  </div>
</template>

<style lang="scss" scoped>
  .input-legend {
    font-size: 1rem;
    line-height: 1.5rem;
    padding-bottom: 0.5rem;
  }
</style>
