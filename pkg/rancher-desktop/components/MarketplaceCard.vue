<template>
  <div class="extensions mt-10">
    <div class="extensions-card">
      <div class="extensions-card-header">
        <img
          :src="extension.logo"
          alt=""
        />
        <div class="extensions-card-header-top">
          <span class="extensions-card-header-title">{{ extension.title }}</span>
          <span class="extensions-card-header-subtitle">{{
            extension.publisher
          }}</span>
          <span class="extensions-card-header-version">{{ extension.version }}</span>
        </div>
      </div>
      <div class="extensions-card-content">
        <span>{{ extension.short_description }}</span>
      </div>

      <a
        :href="extensionLink"
        :title="extensionLink"
        target="_blank"
      >
        {{ t('marketplace.moreInfo') }}
        <i class="icon icon-external-link " />
      </a>
    </div>
    <div class="extensions-card-footer">
      <Banner
        v-if="error"
        color="error"
        class="banner"
      >
        {{ error }}
      </Banner>
      <!-- install button -->
      <button
        v-if="!error && !currentAction && !installed"
        data-test="button-install"
        class="role-primary btn btn-xs"
        @click="appInstallation('install')"
      >
        {{ t('marketplace.labels.install') }}
      </button>
      <!-- upgrade button -->
      <button
        v-if="!error && !currentAction && installed?.canUpgrade"
        class="role-primary btn btn-xs"
        @click="appInstallation('upgrade')"
      >
        {{ t('marketplace.labels.upgrade') }}
      </button>
      <!-- uninstall button -->
      <button
        v-if="!error && !currentAction && installed"
        data-test="button-uninstall"
        class="role-danger btn btn-xs"
        @click="appInstallation('uninstall')"
      >
        {{ t('marketplace.labels.uninstall') }}
      </button>
      <!-- "loading" fake button -->
      <button
        v-if="!error && currentAction"
        data-test="button-loading"
        class="role-primary btn btn-xs"
        disabled="true"
      >
        <span name="loading" is-loading="true">
          <loading-indicator>{{ loadingLabel }}</loading-indicator>
        </span>
      </button>
    </div>
  </div>
</template>

<script lang="ts">
import { Banner } from '@rancher/components';

import LoadingIndicator from '@pkg/components/LoadingIndicator.vue';
import type { ExtensionState, MarketplaceData } from '@pkg/store/extensions';

import type { PropType } from 'vue';

type action = 'install' | 'uninstall' | 'upgrade';

export default {
  components: { LoadingIndicator, Banner },
  props:      {
    extension: {
      type:     Object as PropType<MarketplaceData>,
      required: true,
    },
    installed: {
      type:     Object as undefined | PropType<ExtensionState>,
      required: false,
      default:  undefined,
    },
  },
  data() {
    return {
      currentAction: null as null | action,
      error:         null as string | null,
      response:      null,
      bannerActive:  false,
    };
  },
  computed: {
    versionedExtension() {
      return `${ this.extensionWithoutVersion }:${ this.extension.version }`;
    },
    extensionWithoutVersion() {
      return this.extension.slug;
    },
    extensionLink() {
      // Try to use labels, if available.
      const preferredLabel = 'io.rancherdesktop.extension.more-info';

      const preferredURL = this.extension.labels[preferredLabel]?.trim();

      if (preferredURL) {
        return preferredURL;
      }

      if (!/^[^./]+\//.test(this.extension.slug)) {
        return `https://${ this.extension.slug }`;
      }

      return `https://hub.docker.com/extensions/${ this.extension.slug }`;
    },
    loadingLabel() {
      return this.t(`marketplace.loading.${ this.currentAction }`);
    },
  },

  methods: {
    resetBanners() {
      this.error = null;
    },
    async appInstallation(action: action) {
      this.currentAction = action;
      this.resetBanners();
      const id = action === 'uninstall' ? this.extensionWithoutVersion : this.versionedExtension;
      const verb = action === 'uninstall' ? 'uninstall' : 'install'; // upgrades are installs

      try {
        const result = await this.$store.dispatch(`extensions/${ verb }`, { id });

        if (typeof result === 'string') {
          this.error = result;
          this.currentAction = null;
        } else if (result) {
          this.currentAction = null;
        }
      } finally {
        setTimeout(() => {
          this.resetBanners();
        }, 3_000);
      }
    },
  },
};
</script>

<style lang="scss" scoped>
.extensions {
  height: 100%;
  box-shadow: 0 0 10px 0 rgba(0, 0, 0, 0.1);
  border: 1px solid var(--muted);
  border-top: 4px solid var(--muted);
  transition: all 0.2s ease-in-out;
  padding: 20px;
  display: flex;
  flex-direction: column;

  .extensions-card {
    display: flex;
    flex-direction: column;
    gap: 10px;
    flex-grow: 1;

    &-header {
      align-content: flex;
      align-items: flex-start;
      display: flex;
      flex-direction: row;
      gap: 10px;

      &-top {
        flex: 1;
        display: grid;
        grid-template:
          "title title title"
          "subtitle . version"
          / max-content 1fr max-content;
        gap: 5px;
      }

      &-title {
        grid-area: title;
        font-size: 1.2rem;
        font-weight: 600;
      }

      &-subtitle {
        grid-area: subtitle;
        font-size: 0.8rem;
        font-weight: 400;
      }

      &-version {
        grid-area: version;
        font-size: 0.8rem;
        font-weight: 400;
      }

      img {
        max-width: 40px;
        width: 100%;
        max-height: 40px;
      }
    }
  }

  &-card-footer {
    margin-top: 15px;

    .banner {
      margin: 0;
    }

    button:not(:first-of-type) {
      margin-left: 10px;
    }
  }

  &-more-info {
    position: relative;
    background: red;;
  }
}
</style>
