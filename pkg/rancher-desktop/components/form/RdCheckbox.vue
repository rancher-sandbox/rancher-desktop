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
  },
});
</script>

<template>
  <div class="rd-checkbox-container">
    <checkbox
      :disabled="$attrs.disabled || isLocked"
      v-bind="$attrs"
      v-on="$listeners"
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
  </div>
</template>
