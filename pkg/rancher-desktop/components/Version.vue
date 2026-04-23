<script lang="ts">
import { defineComponent } from 'vue';

export default defineComponent({
  name:  'version',
  props: {
    icon: {
      type:    String,
      default: '',
    },
    isStatusBarItem: {
      type:    Boolean,
      default: false,
    },
  },
  data() {
    return { version: process.env.RD_VERSION ?? '?' };
  },
  computed: {
    getTooltip() {
      return {
        content:     `<b>${ this.t('product.version') }</b>: ${ this.version }`,
        html:        true,
        placement:   'top',
        popperClass: 'tooltip-footer',
      };
    },
  },
});
</script>

<template>
  <span
    v-clean-tooltip="isStatusBarItem ? getTooltip : {}"
    class="versionInfo"
  >
    <i
      v-if="icon"
      class="item-icon"
      :class="icon"
    />
    <span
      class="item-label"
    >
      <b>{{ t('product.version') }}:</b>
    </span>
    <span
      class="item-value"
    >
      {{ version }}
    </span>
  </span>
</template>
