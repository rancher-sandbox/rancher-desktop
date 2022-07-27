<script lang="ts">
import Vue from 'vue';
import { mapState } from 'vuex';

import Banner from '@/components/Banner.vue';

export default Vue.extend({
  name:       'preferences-actions',
  components: { Banner },
  props:      {
    isDirty: {
      type:     Boolean,
      required: true
    }
  },
  computed: {
    ...mapState('preferences', ['severities']),
    severity() {
      if (this.severities.reset) {
        return 'reset';
      }

      if (this.severities.restart) {
        return 'restart';
      }

      return '';
    },
    severityLevel() {
      return this.severity === 'reset' ? 'warning' : 'info';
    },
    iconClass() {
      return `icon-${ this.severityLevel }`;
    }
  },
  methods:  {
    cancel() {
      this.$emit('cancel');
    },
    apply() {
      this.$emit('apply');
    }
  }
});
</script>

<template>
  <div class="preferences-actions">
    <transition
      name="fade"
      appear
    >
      <banner
        v-if="severity"
        :color="severityLevel"
      >
        <span
          class="icon"
          :class="[iconClass]"
        ></span>
        Kubernetes {{ severity }} required.
      </banner>
    </transition>
    <button
      data-test="preferences-cancel"
      class="btn role-secondary"
      @click="cancel"
    >
      Cancel
    </button>
    <button
      class="btn role-primary"
      :disabled="!isDirty"
      @click="apply"
    >
      Apply
    </button>
  </div>
</template>

<style lang="scss" scoped>
  .preferences-actions {
    display: flex;
    justify-content: flex-end;
    gap: 1rem;
    padding: var(--preferences-content-padding);
    border-top: 1px solid var(--header-border);
  }

  .banner {
    margin: 0;
  }

  .fade-enter, .fade-leave-to {
    opacity: 0;
  }

  .fade-active {
    transition: all 0.25s ease-in;
  }
</style>
