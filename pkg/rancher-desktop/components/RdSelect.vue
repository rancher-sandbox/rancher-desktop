<script lang="ts">
import { defineComponent } from 'vue';

export default defineComponent({
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
    /**
     * Ensure that the correct value is emitted by overriding the default
     * listeners to supply a custom input event. Resolves an issue where the
     * entire vnode emits when using v-model.
     * TODO: Issue #5544 Don't use Function as a type
     */
    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
    computedListeners(): Record<string, Function | Function[]> & { input: (e: any) => any; } {
      return Object.assign(
        {},
        this.$listeners,
        { input: (e: any) => this.$emit('input', e.target.value) },
      );
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
      v-on="computedListeners"
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
