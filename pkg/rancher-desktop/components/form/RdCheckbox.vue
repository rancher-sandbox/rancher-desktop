<script lang="ts">
import { Checkbox } from '@rancher/components';
import Vue from 'vue';

export default Vue.extend({
  name:         'rd-checkbox',
  components:   { Checkbox },
  inheritAttrs: false,
  props:        {
    isLocked: {
      type:    Boolean,
      default: false,
    },
    tooltip: {
      type:    String,
      default: null,
    },
    labelKey: {
      type:    String,
      default: null,
    },
    label: {
      type:    String,
      default: null,
    },
    tooltipKey: {
      type:    String,
      default: null,
    },
  },
});
</script>

<template>
  <div class="rd-checkbox-container">
    <checkbox
      :disabled="$attrs.disabled || isLocked"
      v-bind="$attrs"
      v-on="$listeners"
    >
      <template #label>
        <t
          v-if="labelKey"
          :k="labelKey"
          :raw="true"
        />
        <template v-else-if="label">
          {{ label }}
        </template>
        <i
          v-if="tooltipKey"
          v-clean-tooltip="t(tooltipKey)"
          class="checkbox-info icon icon-info icon-lg"
        />
        <i
          v-else-if="tooltip"
          v-clean-tooltip="tooltip"
          class="checkbox-info icon icon-info icon-lg"
        />
        <slot name="after">
          <i
            v-if="isLocked"
            v-tooltip="{
              content: tooltip || t('preferences.locked.tooltip'),
              placement: 'right',
            }"
            class="icon icon-lock"
          />
        </slot>
      </template>
    </checkbox>
  </div>
</template>
