<script lang="ts">
import Vue from 'vue';
export default Vue.extend({ name: 'input-legend' });
</script>

<template>
  <fieldset class="input-legend">
    <legend>
      <slot name="legend"></slot>
    </legend>
    <slot></slot>
  </fieldset>
</template>

<style lang="scss" scoped>
  fieldset {
    all: unset;
  }

  .input-legend {
    legend {
      font-size: 1rem;
      line-height: 1.5rem;
      padding-bottom: 0.5rem;
    }
  }
</style>
