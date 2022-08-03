<script lang="ts">
import Vue from 'vue';
import { mapState } from 'vuex';

import Banner from '@/components/Banner.vue';

const severityMap = {
  reset: {
    icon:       'icon-warning',
    bannerText: 'preferences.actions.banner.reset',
    color:      'warning',
  },
  restart: {
    icon:       'icon-info',
    bannerText: `preferences.actions.banner.restart`,
    color:      'info',
  },
  error: {
    icon:       'icon-error',
    bannerText: `preferences.actions.banner.error`,
    color:      'error',
  },
};

export default Vue.extend({
  name:       'preferences-actions',
  components: { Banner },
  props:      {
    isDirty: {
      type:     Boolean,
      required: true,
    },
  },
  computed: {
    ...mapState('preferences', ['severities']),
    severity(): string {
      if (this.severities.reset) {
        return 'reset';
      }

      if (this.severities.restart) {
        return 'restart';
      }

      if (this.severities.error) {
        return 'error';
      }

      return '';
    },
    severityLevel(): string {
      return this.severity === 'reset' ? 'warning' : 'info';
    },
    iconClass(): string {
      return `icon-${ this.severityLevel }`;
    },
    bannerText(): string {
      return this.t(`preferences.actions.banner.${ this.severity }`);
    },
    severityObject(): typeof severityMap {
      return severityMap[this.severity];
    },
  },
  methods:  {
    cancel() {
      this.$emit('cancel');
    },
    apply() {
      this.$emit('apply');
    },
  },
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
        class="banner-notify"
        :color="severityObject.color"
      >
        <span
          class="icon"
          :class="severityObject.icon"
        />
        {{ t(severityObject.bannerText) }}
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

  .banner-notify {
    margin: 0;
  }

  .fade-enter, .fade-leave-to {
    opacity: 0;
  }

  .fade-active {
    transition: all 0.25s ease-in;
  }
</style>
