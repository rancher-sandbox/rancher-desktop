<script lang="ts">
import Vue from 'vue';

import { ipcRenderer } from '@pkg/utils/ipcRenderer';
export default Vue.extend({
  props: {
    icon: {
      type:    String,
      default: '',
    },
    isStatusBarItem: {
      type:    Boolean,
      default: false,
    },
    isProgressBarVisible: {
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
        content:   `<b>${ this.t('product.version') }</b>: ${ this.version }`,
        placement: 'top',
        classes:   'tooltip-footer',
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
      :class="{'make-icon-inline': isProgressBarVisible, icon: true}"
    />
    <span
      class="item-label"
      :class="{'make-label-invisible': isProgressBarVisible}"
    >
      <b>{{ t('product.version') }}:</b>
    </span>
    <span
      class="item-value"
      :class="{'make-value-invisible': isProgressBarVisible}"
    >
      {{ version }}
    </span>
  </span>
</template>
