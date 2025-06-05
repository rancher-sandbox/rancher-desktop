<!-- A progress bar, with support for indeterminate progress -->
<script lang="ts">
import { defineComponent } from 'vue';
export default defineComponent({
  name: 'progress',
  props: {
    indeterminate: {
      type:    Boolean,
      default: false,
    },
    value: {
      type:    Number,
      default: 0,
    },
    maximum: {
      type:    Number,
      default: 100,
    },
    primaryColor: {
      type:    String,
      default: '--primary',
    },
    secondaryColor: {
      type:    String,
      default: '--border',
    },
  },
  computed: {
    indicatorStyle(): Record<string, string> {
      if (this.indeterminate) {
        return {
          width:      '200%',
          background: `repeating-linear-gradient(
              -45deg,
              var(${ this.primaryColor }),
              transparent 6.25%,
              var(${ this.primaryColor }) 12.5%
            )`.replace(/\s+/g, ' '),
        };
      }

      return {
        width:           `${ this.value * 100 / this.maximum }%`,
        backgroundColor: `var(${ this.primaryColor })`,
      };
    },
    barStyle(): Record<string, string> {
      return { backgroundColor: `var(${ this.secondaryColor })` };
    },
  },
});
</script>

<template>
  <div
    class="bar"
    :class="{indeterminate}"
    :style="barStyle"
  >
    <div
      class="indicator"
      :style="indicatorStyle"
    ></div>
  </div>
</template>

<style lang="scss" scoped>
  .bar {
    $height: 15px;

    width: 100%;
    height: $height;
    border-radius: math.div($height, 2);
    overflow: hidden;
    position: relative;

    .indicator {
      height: 100%;
      position: absolute;
    }

    &.indeterminate {
      .indicator {
        animation: linear infinite indeterminate 8s;
      }
      @keyframes indeterminate {
        from {
          left: -100%;
        }
        to {
          left: 0%;
        }
      }
    }
  }
</style>
