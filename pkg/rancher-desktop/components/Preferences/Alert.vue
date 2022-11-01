<script lang="ts">
import { Banner } from '@rancher/components';
import Vue from 'vue';
import { mapState } from 'vuex';

interface Alert {
  icon: string;
  bannerText: string;
  color: string;
}

type AlertMap = Record<'reset'|'restart'|'error', Alert>;

const alertMap: AlertMap = {
  reset: {
    icon:       'icon-alert',
    bannerText: 'preferences.actions.banner.reset',
    color:      'warning',
  },
  restart: {
    icon:       'icon-info',
    bannerText: `preferences.actions.banner.restart`,
    color:      'info',
  },
  error: {
    icon:       'icon-warning',
    bannerText: `preferences.actions.banner.error`,
    color:      'error',
  },
};

export default Vue.extend({
  name:       'preferences-alert',
  components: { Banner },
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
    alert(): Alert | undefined {
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
  <transition
    name="fade"
    appear
  >
    <banner
      v-if="alert"
      class="banner-notify"
      :color="alert.color"
    >
      <span
        class="icon"
        :class="alert.icon"
      />
      {{ bannerText }}
    </banner>
  </transition>
</template>

<style lang="scss" scoped>
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
