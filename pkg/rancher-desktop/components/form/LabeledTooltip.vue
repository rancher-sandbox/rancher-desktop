<script>
export default {
  props: {
    value: {
      type:    [String, Object],
      default: null,
    },

    status: {
      type:    String,
      default: 'error',
    },

    hover: {
      type:    Boolean,
      default: true,
    },
  },
};
</script>

<template>
  <div
    ref="container"
    class="labeled-tooltip"
    :class="{ [status]: true, hoverable: hover }"
  >
    <template v-if="hover">
      <i
        v-tooltip="value.content ? { ...{ content: value.content, classes: [`tooltip-${status}`] }, ...value } : value"
        :class="{ hover: !value }"
        class="icon icon-info-circle status-icon"
      />
    </template>
    <template v-else>
      <i
        :class="{ hover: !value }"
        class="icon icon-info-circle status-icon"
      />
      <div
        v-if="value"
        class="tooltip"
        x-placement="bottom"
      >
        <div class="tooltip-arrow" />
        <div class="tooltip-inner">
          {{ value }}
        </div>
      </div>
    </template>
  </div>
</template>

<style lang='scss'>
.labeled-tooltip {
    position: absolute;
    width: 100%;
    height: 100%;
    left: 0;
    top: 0;

    &.hoverable {
      height: 0%;
    }

     .status-icon {
         position:  absolute;
         right: 30px;
         top: $input-padding-lg;
         font-size: 20px;
         z-index: z-index(hoverOverContent);

     }

    .tooltip {
        position: absolute;
        width: calc(100% + 2px);
        top: calc(100% + 6px);

        .tooltip-arrow {
            right: 30px;
        }

        .tooltip-inner {
            padding: 10px;
        }
    }

    @mixin tooltipColors($color) {
        .status-icon {
            color: $color;
        }
        .tooltip {
            .tooltip-inner {
                color: var(--input-bg);
                background: $color;
                border-color: $color;
            }

            .tooltip-arrow {
                border-bottom-color: $color;
                &:after {
                    border: none;
                }
            }
        }
    }

    &.error {
        @include tooltipColors(var(--error));
    }

    &.warning {
        @include tooltipColors(var(--warning));
    }

    &.success {
        @include tooltipColors(var(--success));
    }
}
</style>
