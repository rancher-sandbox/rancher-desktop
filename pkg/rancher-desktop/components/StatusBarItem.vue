<script lang="ts">
import Vue, { PropType, VueConstructor } from 'vue';

import NetworkStatus from '@pkg/components/NetworkStatus.vue';
import Version from '@pkg/components/Version.vue';

export type StatusBarItemData = {
  value: string,
  label: {
    tooltip: string,
    bar: string,
  },
};

export default Vue.extend({
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
    isProgressBarVisible: {
      type:    Boolean,
      default: false,
    },
  },
  computed: {
    getSubComponent(): VueConstructor | undefined {
      if (this.subComponent) {
        return this.subComponent === 'Version' ? Version : NetworkStatus;
      }

      return undefined;
    },
    getTooltip(): { content: string, placement: string, classes: string } {
      return {
        content:   `<b>${ this.t(this.data.label.tooltip) }</b>: ${ this.data.value }`,
        placement: 'top',
        classes:   'tooltip-footer',
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
        :class="{'make-icon-inline': isProgressBarVisible}"
        :src="svgIconPath"
      >
      <i
        v-else
        class="item-icon"
        :class="{'make-icon-inline': isProgressBarVisible, icon: true}"
      />
      <span
        class="item-label"
        :class="{'make-label-invisible': isProgressBarVisible}"
      >
        <b>{{ t(data.label.bar) }}:</b>
      </span>
      <span
        class="item-value"
        :class="{'make-value-invisible': isProgressBarVisible}"
      >
        {{ data.value }}
      </span>
    </span>
    <component
      :is="getSubComponent"
      v-if="subComponent"
      :icon="icon"
      :is-status-bar-item="true"
      :is-progress-bar-visible="isProgressBarVisible"
    ></component>
  </div>
</template>

<style scoped lang="scss">
.status-bar-item {
  .item-icon, ::v-deep .item-icon {
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

  @media (max-width: 500px) {
    .item-label, ::v-deep .item-label {
      display: none;
    }

    .item-icon, ::v-deep .item-icon {
      display: inline;
    }
  }

  @media (max-width: 450px) {
    .item-value, ::v-deep .item-value {
      display: none;
    }

    .item-icon, ::v-deep .item-icon {
      display: inline;
    }
  }

  @media (max-width: 1000px) {
    .make-label-invisible, ::v-deep .make-label-invisible {
      display: none;
    }

    .make-icon-inline, ::v-deep .make-icon-inline {
      display: inline;
    }
  }

  @media (max-width: 900px) {
    .make-value-invisible, ::v-deep .make-value-invisible {
      display: none;
    }

    .make-icon-inline, ::v-deep .make-icon-inline {
      display: inline;
    }
  }
}
</style>
