<script lang="ts">
import { RadioButton } from '@rancher/components';
import Vue from 'vue';

export default Vue.extend({
  name:         'rd-radio-button',
  components:   { RadioButton },
  inheritAttrs: false,
  props:        {
    isLocked: {
      type:    Boolean,
      default: false,
    },
  },
});
</script>

<template>
  <div class="rd-radio-button-container">
    <radio-button
      :val="$attrs.val"
      :value="$attrs.value"
      :class="{ 'locked' : isLocked && !$attrs.disabled }"
      :disabled="$attrs.disabled || isLocked"
      v-bind="$attrs"
      v-on="$listeners"
    >
      <template
        v-for="(_, name) in $slots"
        #[name]="slotData"
      >
        <slot
          :name="name"
          v-bind="slotData"
        />
      </template>
    </radio-button>
  </div>
</template>

<style lang="scss" scoped>
  .rd-radio-button-container {
    .locked::v-deep {
      .radio-custom {
        opacity: 1;

        &:not([aria-checked="true"]) {
          opacity: 1;
          background-color: var(--radio-locked-bg-unchecked);
        }
      }
    }
  }
</style>
