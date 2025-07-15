<script lang="ts">

import { defineComponent } from 'vue';

import LabeledBadge from '@pkg/components/form/LabeledBadge.vue';
import TooltipIcon from '@pkg/components/form/TooltipIcon.vue';

/**
 * Groups several controls as well as labels
 */
export default defineComponent({
  name:       'rd-fieldset',
  components: { TooltipIcon, LabeledBadge },
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
    isExperimental: {
      type:    Boolean,
      default: false,
    },
    isLocked: {
      type:    Boolean,
      default: false,
    },
  },
  computed: {
    lockedTooltip() {
      const legendTooltip = this.legendTooltip ? ` <br><br> ${ this.legendTooltip }` : '';

      return `${ this.t('preferences.locked.tooltip') }${ legendTooltip }`;
    },
  },
});
</script>

<template>
  <fieldset class="rd-fieldset">
    <legend>
      <slot name="legend">
        <span>{{ legendText }}</span>
        <labeled-badge
          v-if="badgeText"
          :text="badgeText"
        />
        <tooltip-icon
          v-if="isExperimental"
        />
        <i
          v-if="isLocked"
          v-tooltip="{
            content: lockedTooltip,
            html: true,
            placement: 'right'
          }"
          class="icon icon-lock"
        />
        <i
          v-else-if="legendTooltip"
          v-tooltip="{
            content: legendTooltip,
            html: true,
          }"
          class="icon icon-info-circle icon-lg"
        />
      </slot>
    </legend>
    <slot
      name="default"
      :is-locked="isLocked"
    >
      <!-- Slot content -->
    </slot>
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

      > * {
        margin-right: 0.25rem;
      }
    }
  }
</style>
