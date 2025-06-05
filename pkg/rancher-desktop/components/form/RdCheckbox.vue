<script lang="ts">
import { Checkbox } from '@rancher/components';
import { defineComponent } from 'vue';

import TooltipIcon from '@pkg/components/form/TooltipIcon.vue';

export default defineComponent({
  name:         'rd-checkbox',
  components:   { TooltipIcon, Checkbox },
  inheritAttrs: false,
  props:        {
    isExperimental: {
      type:    Boolean,
      default: false,
    },
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
      class="checkbox"
      :disabled="$attrs.disabled || isLocked"
      v-bind="$attrs"
      v-on="$listeners"
    >
      <template #label>
        <slot name="label">
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
        </slot>
        <slot name="after">
          <tooltip-icon
            v-if="isExperimental"
            class="tooltip-icon"
          />
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
    <div class="checkbox-below">
      <slot name="below" />
    </div>
  </div>
</template>

<style lang="scss" scoped>
.checkbox :deep(.checkbox-outer-container-description) {
  font-size: 11px;
}
.tooltip-icon {
  margin-left: 0.25rem;
}
.checkbox-below {
  margin-left: 19px;
  font-size: 11px;
  &:empty {
    display: none;
  }
}

</style>
