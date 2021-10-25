<script>

export default {
  props: {
    // Set either value or color+label
    // A resource with stateBackground and stateDisplay
    value: {
      type:    Object,
      default: null,
    },

    color: {
      type:    String,
      default: null,
    },

    icon: {
      type:    String,
      default: null
    },

    label: {
      type:    String,
      default: null,
    },
  },

  computed: {
    bg() {
      return this.value?.stateBackground || this.color;
    },

    msg() {
      return this.value?.stateDisplay || this.label;
    }
  }
};
</script>

<template>
  <span :class="{'badge-state': true, [bg]: true}">
    <i v-if="icon" class="icon" :class="{[icon]: true, 'mr-5': !!msg}" />{{ msg }}
  </span>
</template>

<style lang="scss">
  .badge-state {
    padding: 2px 10px;
    border: 1px solid transparent;
    border-radius: 20px;

    &.bg-info {
      border-color: var(--primary);
    }

    &.bg-error {
      border-color: var(--error);
    }

    &.bg-warning {
      border-color: var(--warning);
    }

    // Successful states are de-emphasized by using [text-]color instead of background-color
    &.bg-success {
      color: var(--success);
      background: transparent;
      border-color: var(--success);
    }
  }

  .sortable-table TD .badge-state {
    @include clip;
    display: inline-block;
    max-width: 100%;
    position: relative;
    max-width: 110px;
    font-size: .85em;
    vertical-align: middle;
  }
</style>
