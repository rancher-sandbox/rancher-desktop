<template>
  <div class="extensions mt-10">
    <div class="extensions-card">
      <div class="extensions-card-header">
        <img
          :src="extension.logo_url.small"
          alt=""
        />
        <div class="extensions-card-header-top">
          <span class="extensions-card-header-title">{{ extension.name }}</span>
          <span class="extensions-card-header-subtitle">{{
            extension.publisher.name
          }}</span>
        </div>
      </div>
      <div class="extensions-card-content">
        <span>{{ extension.short_description }}</span>
      </div>

      <a
        :href="extensionLink"
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
      <button
        v-if="!error"
        data-test="button-install"
        :class="isInstalled ? 'role-danger': 'role-primary'"
        class="btn btn-xs"
        :disabled="loading"
        @click="appInstallation(installationAction)"
      >
        <span
          v-if="loading"
          name="loading"
          :is-loading="loading"
        >
          <loading-indicator>{{ buttonLabel }}</loading-indicator>
        </span>
        <span v-if="!loading">{{ buttonLabel }}</span>
      </button>
    </div>
  </div>
</template>

<script>

import { Banner } from '@rancher/components';

import LoadingIndicator from '@pkg/components/LoadingIndicator.vue';
import demoMetadata from '@pkg/utils/_demo_metadata.js';

export default {
  components: { LoadingIndicator, Banner },
  props:      {
    extension: {
      type:     Object,
      required: true,
    },
    credentials: {
      type:     Object,
      required: true,
    },
    isInstalled: {
      type:     Boolean,
      required: true,
    },
  },
  data() {
    return {
      loading:          false,
      extensionDetails: null,
      error:            null,
      response:         null,
      bannerActive:     false,
    };
  },
  computed: {
    installationAction() {
      return this.isInstalled ? 'uninstall' : 'install';
    },
    versionedExtension() {
      return `${ this.extensionWithoutVersion }:${ this.extensionDetails?.version }`;
    },
    extensionWithoutVersion() {
      const index = this.extension.slug.lastIndexOf(':');

      return this.extension.slug.substring(0, index) || this.extension.slug;
    },
    extensionLink() {
      return this.extension.slug.includes('ghcr.io') ? `https://${ this.extension.slug }` : `https://hub.docker.com/extensions/${ this.extension.slug }`;
    },
    buttonLabel() {
      if (this.loading) {
        return this.isInstalled ? this.t('marketplace.sidebar.uninstallButton.loading') : this.t('marketplace.sidebar.installButton.loading');
      } else {
        return this.isInstalled ? this.t('marketplace.sidebar.uninstallButton.label') : this.t('marketplace.sidebar.installButton.label');
      }
    },
  },

  mounted() {
    this.metadata = demoMetadata[this.extensionWithoutVersion];

    if (!this.metadata) {
      return;
    }

    this.extensionDetails = {
      name:
        this.metadata?.LatestVersion.Labels['org.opencontainers.image.title'] ||
        this.extensionWithoutVersion,
      version: this.metadata?.LatestVersion.Tag || [],
    };
  },
  methods: {
    resetBanners() {
      this.error = null;
    },
    appInstallation(action) {
      this.loading = true;
      this.resetBanners();

      fetch(
        `http://localhost:${ this.credentials?.port }/v1/extensions/${ action }?id=${ this.versionedExtension }`,
        {
          method:  'POST',
          headers: new Headers({
            Authorization: `Basic ${ window.btoa(
              `${ this.credentials?.user }:${ this.credentials?.password }`,
            ) }`,
            'Content-Type': 'application/x-www-form-urlencoded',
          }),
        },
      ).then((r) => {
        if (!r.ok) {
          this.error = r.statusText;
          this.loading = false;
        }

        if (r.status === 201) {
          this.loading = false;
        }
      })
        .finally(() => {
          this.$emit('update:extension');

          setTimeout(() => {
            this.resetBanners();
          }, 3000);
        });
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
        display: flex;
        flex-direction: column;
        gap: 5px;
      }

      &-title {
        font-size: 1.2rem;
        font-weight: 600;
      }

      &-subtitle {
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
  }

  &-more-info {
    position: relative;
    background: red;;
  }
}
</style>
