<script lang="ts">

import * as Components from '@rancher/components';
import { defineComponent } from 'vue';

import type { PropType } from 'vue';

const { BadgeState } = (Components as any).default ?? Components;

export default defineComponent({
  name:       'labeled-badge',
  components: { BadgeState },
  props:      {
    color: {
      type: String as PropType<'bg-primary' | 'bg-default' | 'bg-darker' | 'bg-success' | 'bg-info' | 'bg-warning'
        | 'bg-error'>,
      default: 'bg-darker',
    },
    text: {
      type:     String,
      required: true,
    },
  },
});
</script>

<template>
  <badge-state
    class="badge"
    :color="color"
    :label="text"
  />
</template>

<style lang="scss" scoped>
  .badge {
    line-height: initial;
    letter-spacing: initial;
    font-size: 10px;
  }
</style>
