<script lang="ts">
import Vue from 'vue';
/**
 * Groups several controls as well as labels
 */
export default Vue.extend({ name: 'rd-fieldset' });
</script>

<template>
  <fieldset class="rd-fieldset">
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

  .rd-fieldset {
    legend {
      font-size: 1rem;
      line-height: 1.5rem;
      padding-bottom: 0.5rem;
    }
  }
</style>
