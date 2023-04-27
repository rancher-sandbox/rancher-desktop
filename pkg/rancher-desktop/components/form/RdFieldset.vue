<script lang="ts">
import Vue from 'vue';

import LabeledBadge from '@pkg/components/form/LabeledBadge.vue';
/**
 * Groups several controls as well as labels
 */
export default Vue.extend({
  name:       'rd-fieldset',
  components: { LabeledBadge },
  props:      {
    legendText: {
      type:    String,
      default: '',
    },
    badgeText: {
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
        <labeled-badge
          v-if="badgeText"
          :text="badgeText"
        />
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
