<script lang="ts">
import { ValidationProvider } from 'vee-validate';
import Vue from 'vue';

export default Vue.extend({
  name:         'rd-input',
  components:   { ValidationProvider },
  inheritAttrs: false,
  props:        {
    rules: {
      type:    [String, Object],
      default: null,
    },
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
  <ValidationProvider
    v-slot="v"
    :name="rules.name"
    slim
    :rules="rules.rule"
    class="validation"
  >
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
        <span
          v-if="!v.valid && !v.untouched"
          class="errors"
        >
          {{ rules.error }}
        </span>
      </slot>
    </div>
  </ValidationProvider>
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
  .errors {
    color: var(--error);
  }
</style>
