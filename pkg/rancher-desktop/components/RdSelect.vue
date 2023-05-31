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
  computed: {
    selectedValue: {
      get(): string {
        return this.value;
      },
      set(newValue: string): void {
        this.$emit('input', newValue);
      },
    },
  },
});
</script>

<template>
  <div class="rd-select-container">
    <select
      v-model="selectedValue"
      v-bind="$attrs"
      :class="{ 'locked' : isLocked && !$attrs.disabled }"
      :disabled="$attrs.disabled || isLocked"
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
        class="icon icon-lock"
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

  .locked {
    color: var(--dropdown-locked-text);

    &:hover {
      color: var(--dropdown-locked-text);
    }
  }
</style>
