<script lang="ts">
import Vue from 'vue';

export default Vue.extend({
  name:         'rd-select',
  inheritAttrs: false,
  props:        {
    value: {
      type:    String,
      default: '',
    },
    isLocked: {
      type:    Boolean,
      default: false,
    },
    tooltip: {
      type:    String,
      default: null,
    },
  },
});
</script>

<template>
  <div class="rd-select-container">
    <select
      :value="value"
      :disabled="$attrs.disabled || isLocked"
      v-bind="$attrs"
      v-on="$listeners"
    >
      <slot name="default">
        <!-- Slot contents -->
      </slot>
    </select>
    <slot name="after">
      <i
        v-if="isLocked"
        v-tooltip="{
          content: tooltip || t('preferences.locked.tooltip'),
          placement: 'right'
        }"
        class="icon icon-lock icon-lg"
      />
    </slot>
  </div>
</template>

<style lang="scss" scoped>
  .rd-select-container {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
</style>
