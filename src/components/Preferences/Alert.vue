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
      {{ t(alert.bannerText, { }, true) }}
      <v-popover v-if="preferencesError">
        <a class="text-error">Click here to learn more.</a>
        <template #popover>
          {{ errorTitle }}
          <ul>
            <li v-for="(error, index) in errorRest" :key="index">
              {{ error }}
            </li>
          </ul>
        </template>
      </v-popover>
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

  .text-error {
    cursor: pointer;
    font-weight: 600;
  }
</style>

<style lang="scss">
  // Adding unscoped style to control the background of the popover so that it
  // will match the background color of v-tooltip. This approach isn't ideal,
  // but it's been proving quite difficult to make use of v-deep because:
  //
  // 1. Classes for v-popover aren't attached to root element in the template
  // 2. The popover is inserted into the DOM at the body
  .popover .popover-inner {
    background: var(--tooltip-bg);
  }
</style>
