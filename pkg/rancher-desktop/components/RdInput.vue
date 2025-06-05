<script lang="ts">
import { defineComponent } from 'vue';

export default defineComponent({
  name:         'rd-input',
  inheritAttrs: false,
  props:        {
    value: {
      type:    [String, Number],
      default: null,
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
  <div class="rd-input-container">
    <input
      :value="value"
      :class="{ 'locked' : isLocked && !$attrs.disabled }"
      :disabled="$attrs.disabled || isLocked"
      v-bind="$attrs"
      v-on="$listeners"
    />
    <slot name="after">
      <i
        v-if="isLocked"
        v-tooltip="{
          content: tooltip || t('preferences.locked.tooltip'),
          placement: 'right'
        }"
        class="icon icon-lock"
      />
    </slot>
  </div>
</template>

<style lang="scss" scoped>
  .rd-input-container {
    display: flex;
    align-items: center;
    gap: 0.5rem;

    .locked {
      color: var(--input-locked-text);

      &:hover {
        color: var(--input-locked-text);
      }
    }
  }
</style>
