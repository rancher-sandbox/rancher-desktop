<script>
export default {
  inject: ['addTab', 'removeTab', 'sideTabs'],

  props: {
    label: {
      default: null,
      type:    String,
    },
    labelKey: {
      default: null,
      type:    String,
    },
    name: {
      required: true,
      type:     String,
    },
    tooltip: {
      default: null,
      type:    [String, Object],
    },
    weight: {
      default:  0,
      required: false,
      type:     Number,
    },

    showHeader: {
      type:    Boolean,
      default: null, // Default true for side-tabs, false for top.
    },
  },

  data() {
    return { active: null };
  },

  computed: {
    labelDisplay() {
      if ( this.labelKey ) {
        return this.$store.getters['i18n/t'](this.labelKey);
      }

      if ( this.label ) {
        return this.label;
      }

      return this.name;
    },

    shouldShowHeader() {
      if ( this.showHeader !== null ) {
        return this.showHeader;
      }

      return this.sideTabs || false;
    },
  },

  watch: {
    active(neu) {
      if (neu) {
        this.$emit('active');
      }
    },
  },

  mounted() {
    this.addTab(this);
  },

  beforeUnmount() {
    this.removeTab(this);
  },
};
</script>

<template>
  <section
    v-show="active"
    :id="name"
    :aria-hidden="!active"
    role="tabpanel"
  >
    <h2 v-if="shouldShowHeader">
      {{ label }}
      <i
        v-if="tooltip"
        v-tooltip="tooltip"
        class="icon icon-info-circle icon-lg"
      />
    </h2>
    <slot v-bind="{active}" />
  </section>
</template>
