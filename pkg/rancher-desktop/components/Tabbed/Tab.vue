<script>
export default {
  inject: ['addTab', 'removeTab', 'sideTabs'],

  props: {
    label: {
      default: null,
      type:    String
    },
    labelKey: {
      default: null,
      type:    String
    },
    name: {
      required: true,
      type:     String
    },
    tooltip: {
      default: null,
      type:    [String, Object]
    },
    weight: {
      default:  0,
      required: false,
      type:     Number
    },
    showHeader: {
      type:    Boolean,
      default: null, // Default true for side-tabs, false for top.
    },
    displayAlertIcon: {
      type:    Boolean,
      default: null
    },
    error: {
      type:    Boolean,
      default: false
    },
    badge: {
      default:  0,
      required: false,
      type:     Number
    },
  },

  emits: ['active'],

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
    }
  },

  watch: {
    active(neu) {
      if (neu) {
        this.$emit('active');
      }
    }
  },

  mounted() {
    this.addTab(this);
  },

  beforeUnmount() {
    this.removeTab(this);
  }
};
</script>

<template>
  <section
    v-show="active"
    :id="name"
    :aria-hidden="!active"
    role="tabpanel"
  >
    <div
      v-if="shouldShowHeader"
      class="tab-header"
    >
      <h2>
        {{ labelDisplay }}
        <i
          v-if="tooltip"
          v-clean-tooltip="tooltip"
          class="icon icon-info icon-lg"
        />
      </h2>
      <slot name="tab-header-right" />
    </div>
    <slot v-bind="{active}" />
  </section>
</template>

<style lang="scss" scoped>
.tab-header {
  display: flex;
  justify-content: space-between;
  margin-bottom: 15px;
  align-items: center;

  h2 {
    margin: 0;

  }
}
</style>
