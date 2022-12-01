<script lang="ts">
import Vue from 'vue';
import { mapState } from 'vuex';

interface AlertType {
  bannerText: string;
  color: string;
}

type AlertMap = Record<'reset'|'restart'|'error', AlertType>;

const alertMap: AlertMap = {
  reset: {
    bannerText: 'preferences.actions.banner.reset',
    color:      'warning',
  },
  restart: {
    bannerText: `preferences.actions.banner.restart`,
    color:      'info',
  },
  error: {
    bannerText: `preferences.actions.banner.error`,
    color:      'error',
  },
};

export default Vue.extend({
  name:       'preferences-alert',
  computed:   {
    ...mapState('preferences', ['severities', 'preferencesError']),
    severity(): keyof AlertMap | undefined {
      if (this.severities.error) {
        return 'error';
      }

      if (this.severities.reset) {
        return 'reset';
      }

      if (this.severities.restart) {
        return 'restart';
      }

      return undefined;
    },
    alert(): AlertType | undefined {
      if (!this.severity) {
        return undefined;
      }

      return alertMap[this.severity];
    },
    bannerText(): string | null {
      if (this.preferencesError) {
        return this.preferencesError;
      }

      if (this.alert) {
        return this.t(this.alert.bannerText, { }, true);
      }

      return null;
    },
    errorSplit(): string[] {
      return this.preferencesError.split(/\r?\n/);
    },
    errorTitle(): string {
      return this.errorSplit[0];
    },
    errorRest(): string[] {
      return this.errorSplit.slice(1, this.errorSplit.length);
    },
  },
});
</script>

<template>
  <div class="alert">
    <span
      v-if="alert"
      class="alert-text"
      :class="alert.color"
    >
      {{ bannerText }}
    </span>
  </div>
</template>

<style lang="scss" scoped>
  .alert {
    .alert-text {
      &.info {
        color: var(--primary);
      }

      &.warning {
        color: var(--warning);
      }

      &.error {
        color: var(--error);
      }
    }
  }
</style>
