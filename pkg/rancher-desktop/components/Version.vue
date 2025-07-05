<script lang="ts">
import { defineComponent } from 'vue';

import { ipcRenderer } from '@pkg/utils/ipcRenderer';
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
    return { version: this.t('product.versionChecking') };
  },
  computed: {
    getTooltip(): { content: string, placement: string, classes: string } {
      return {
        content:     `<b>${ this.t('product.version') }</b>: ${ this.version }`,
        html:        true,
        placement:   'top',
        popperClass: 'tooltip-footer',
      };
    },
  },
  mounted() {
    ipcRenderer.on('get-app-version', (event, version) => {
      this.version = version;
    });
    ipcRenderer.send('get-app-version');
  },
});
</script>

<template>
  <span
    v-tooltip="isStatusBarItem ? getTooltip : {}"
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
