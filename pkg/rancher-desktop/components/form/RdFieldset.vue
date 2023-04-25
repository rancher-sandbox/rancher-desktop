<script lang="ts">
import Vue from 'vue';
/**
 * Groups several controls as well as labels
 */
export default Vue.extend({
  name:  'rd-fieldset',
  props: {
    legendText: {
      type:    String,
      default: '',
    },
    legendTooltip: {
      type:    String,
      default: '',
    },
  },
});
</script>

<template>
  <fieldset class="rd-fieldset">
    <legend>
      <slot name="legend">
        {{ legendText }}
        <i v-if="legendTooltip" v-tooltip="legendTooltip" class="icon icon-info icon-lg" />
      </slot>
    </legend>
    <slot></slot>
  </fieldset>
</template>

<style lang="scss" scoped>
  .rd-fieldset {
    margin: 0;
    padding: 0;
    border: none;

    legend {
      font-size: 1rem;
      color: inherit;
      line-height: 1.5rem;
      padding-bottom: 0.5rem;
    }
  }
</style>
