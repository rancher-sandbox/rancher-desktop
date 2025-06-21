<script>
import { defineComponent } from 'vue';

import { ipcRenderer } from '@pkg/utils/ipcRenderer';
import { networkStatus } from '@pkg/utils/networks';

export default defineComponent({
  name:  'network-status',
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
    return { networkStatus: true };
  },
  computed: {
    networkStatusLabel() {
      return this.networkStatus ? networkStatus.CONNECTED : networkStatus.OFFLINE;
    },
    getTooltip() {
      return {
        content:     `<b>${ this.t('product.networkStatus') }</b>: ${ this.networkStatusLabel }`,
        html:        true,
        placement:   'top',
        popperClass: 'tooltip-footer',
      };
    },
  },
  mounted() {
    this.onNetworkStatusUpdate(window.navigator.onLine);
    ipcRenderer.on('update-network-status', (event, status) => {
      this.onNetworkStatusUpdate(status);
    });
    window.addEventListener('online', () => {
      this.onNetworkStatusUpdate(true);
    });
    window.addEventListener('offline', () => {
      this.onNetworkStatusUpdate(false);
    });
    // This event is triggered when the Preferences page is revealed (among other times).
    // If the network status changed while the window was closed, this will update it.
    window.addEventListener('pageshow', () => {
      this.onNetworkStatusUpdate(window.navigator.onLine);
    });
  },
  methods: {
    onNetworkStatusUpdate(status) {
      this.$data.networkStatus = status;
    },
  },
});
</script>

<template>
  <span
    v-tooltip="isStatusBarItem ? getTooltip : {}"
    class="networkStatusInfo"
  >
    <i
      v-if="icon"
      class="item-icon"
      :class="icon"
    />
    <span
      class="item-label"
    >
      <b>{{ t('product.networkStatus') }}:</b>
    </span>
    <span
      class="item-value"
    >
      {{ networkStatusLabel }}
    </span>
    <i
      v-if="isStatusBarItem"
      class="icon icon-dot"
      :class="networkStatus ? 'online' : 'offline'"
    ></i>
  </span>
</template>

<style scoped lang="scss">
.networkStatusInfo {
  .icon-dot {
    font-size: 8px;
    padding: 2px;

    &.online {
      color: #32CD32FF;
    }
    &.offline {
      color: #B30000;
    }
  }

  @media (max-width: 900px) {
    .icon-dot {
      vertical-align: top;
      padding: 0;
    }
  }
}
</style>
