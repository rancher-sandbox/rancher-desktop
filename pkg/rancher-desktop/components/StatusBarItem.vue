<script lang="ts">
import { PropType, Component, defineComponent } from 'vue';

import NetworkStatus from '@pkg/components/NetworkStatus.vue';
import Version from '@pkg/components/Version.vue';

export type StatusBarItemData = {
  value: string,
  label: {
    tooltip: string,
    bar: string,
  },
};

export default defineComponent({
  name:  'status-bar-item',
  props: {
    data: {
      type:    Object as PropType<StatusBarItemData>,
      default: null,
    },
    subComponent: {
      type:    String,
      default: null,
    },
    icon: {
      type:     String,
      required: true,
    },
  },
  computed: {
    getSubComponent(): Component | undefined {
      if (this.subComponent) {
        return this.subComponent === 'Version' ? Version : NetworkStatus;
      }

      return undefined;
    },
    getTooltip(): { content: string, placement: string, popperClass: string } {
      return {
        content:     `<b>${ this.t(this.data.label.tooltip) }</b>: ${ this.data.value }`,
        html:        true,
        placement:   'top',
        popperClass: 'tooltip-footer',
      };
    },
    isSvgIcon(): boolean {
      return this.icon.endsWith('.svg');
    },
    svgIconPath(): string | null {
      return this.isSvgIcon ? require(`@pkg/assets/images/${ this.icon }`) : null;
    },
  },
});
</script>

<template>
  <div class="status-bar-item">
    <span
      v-if="data"
      v-tooltip="getTooltip"
    >
      <img
        v-if="isSvgIcon"
        class="item-icon icon-svg"
        :src="svgIconPath"
      >
      <i
        v-else
        class="item-icon"
        :class="icon"
      />
      <span
        class="item-label"
      >
        <b>{{ t(data.label.bar) }}:</b>
      </span>
      <span
        class="item-value"
      >
        {{ data.value }}
      </span>
    </span>
    <component
      :is="getSubComponent"
      v-if="subComponent"
      :icon="icon"
      :is-status-bar-item="true"
    ></component>
  </div>
</template>

<style scoped lang="scss">
.status-bar-item {
  .item-icon, :deep(.item-icon) {
    padding-right: 2px;
    vertical-align: middle;
    display: none;

    &.icon-svg {
      width: 14px;

      @media (prefers-color-scheme: dark) {
          filter: brightness(0) invert(100%) grayscale(1) brightness(2);
      }

      @media (prefers-color-scheme: light) {
          filter: brightness(0) grayscale(1) brightness(4);
      }
    }
  }

  @media (max-width: 1000px) {
    .item-label, :deep(.item-label) {
      display: none;
    }

    .item-icon, :deep(.item-icon) {
      display: inline;
    }
  }

  @media (max-width: 900px) {
    .item-value, :deep(.item-value) {
      display: none;
    }

    .item-icon, :deep(.item-icon) {
      display: inline;
    }
  }
}
</style>
