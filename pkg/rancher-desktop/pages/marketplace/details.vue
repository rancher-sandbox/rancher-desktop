<template>
  <div class="extension">
    <nuxt-child />
    <div class="extension-content">
      <div>
        <Banner v-if="error" color="error" class="banner">
          {{ error }}
        </Banner>
        <Banner v-if="response" color="info" class="banner">
          {{ response }}
        </Banner>

        <div v-html="htmlContent" />
        <img :src="getPreviewImage" alt="" />
      </div>
      <div class="extension-content-sidebar">
        <button
          :class="['btn', 'btn-xs', 'role-primary']"
          :disabled="loading"
          @click="appInstallation(installationAction)"
        >
          <span v-if="loading" name="loading" :is-loading="loading">
            <loading-indicator>{{ buttonLabel }}</loading-indicator>
          </span>

          <span v-if="!loading">{{ buttonLabel }}</span>
        </button>

        <div v-if="extensionDetails" class="extension-content-sidebar-version">
          <div class="extension-content-sidebar-version-header">
            <img :src="extensionDetails.icon" alt="" />
            <span>{{ extensionDetails.name }}</span>
          </div>

          <hr />

          <div class="extension-content-sidebar-version-element">
            <p>{{ t('marketplace.sidebar.latestVersion') }}</p>
            <span>{{ extensionDetails.version }}</span>
          </div>

          <div class="extension-content-sidebar-version-element">
            <p>{{ t('marketplace.sidebar.latestUpdate') }}</p>
            <span>{{ formatDate(extensionDetails.lastUpdate) }}</span>
          </div>

          <div class="extension-content-sidebar-version-element">
            <p>{{ t('marketplace.sidebar.categories') }}</p>
            <div v-for="categ in extensionDetails.categories" :key="categ">
              <span class="badge">{{ categ }}</span>
            </div>
          </div>

          <div class="extension-content-sidebar-version-element">
            <p>{{ t('marketplace.sidebar.platforms') }}</p>
            <div
              v-for="imageStats in extensionDetails.platforms"
              :key="imageStats.Created"
              class="extension-content-sidebar-version-element-platform"
            >
              <p>
                <b>OS:</b>
                {{ imageStats.OS }} | {{ imageStats.Arch }}
              </p>
              <p>
                <b>Updated:</b>
                {{ formatDate(imageStats.Created) }}
              </p>
            </div>
          </div>

          <div class="extension-content-sidebar-version-element">
            <p>{{ t('marketplace.sidebar.links') }}</p>
            <ul>
              <li v-for="links in extensionDetails.links" :key="links.title">
                <a :href="links.url" target="_blank">
                  {{ links.title }}
                </a>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { Banner } from '@rancher/components';
import dayjs from 'dayjs';

import LoadingIndicator from '@pkg/components/LoadingIndicator.vue';
import demoMetadata from '@pkg/utils/_demo_metadata.js';

export default {
  name:       'marketplace-details',
  components: { LoadingIndicator, Banner },
  data() {
    return {
      extension:        this.$route.params.slug,
      extensionDetails: null,
      metadata:         null,
      image:            this.$route.params.image,
      loading:          false,
      isInstalled:      null,
      error:            null,
      response:         null,
      credentials:      null,
    };
  },

  async fetch() {
    this.credentials = await this.$store.dispatch(
      'credentials/fetchCredentials',
    );

    fetch(`http://localhost:${ this.credentials?.port }/v1/extensions`, {
      headers: new Headers({
        Authorization: `Basic ${ window.btoa(
          `${ this.credentials?.user }:${ this.credentials?.password }`,
        ) }`,
        'Content-Type': 'application/x-www-form-urlencoded',
      }),
    }).then((response) => {
      if (!response.ok) {
        return;
      }

      response.json().then((res) => {
        this.isInstalled = Object.keys(res).includes(this.extension);
      });
    });
  },

  computed: {
    buttonLabel() {
      if (this.loading) {
        return this.isInstalled ? this.t('marketplace.sidebar.uninstallButton.loading') : this.t('marketplace.sidebar.installButton.loading');
      } else {
        return this.isInstalled ? this.t('marketplace.sidebar.uninstallButton.label') : this.t('marketplace.sidebar.installButton.label');
      }
    },
    installationAction() {
      return this.isInstalled ? 'uninstall' : 'install';
    },
    htmlContent() {
      if (!this.metadata) {
        return;
      }

      return (
        this.metadata?.LatestVersion.Labels[
          'com.docker.extension.detailed-description'
        ].replace('h1', 'h2') || ''
      );
    },

    getPreviewImage() {
      if (!this.metadata) {
        return;
      }

      // TODO: Maybe we want to use a gallery here ?
      const screenshots =
        this.metadata?.LatestVersion.Labels['com.docker.extension.screenshots'];

      return JSON.parse(screenshots)[0].url || '';
    },
    versionedExtension() {
      return `${ this.extension }:${ this.extensionDetails.version }`;
    },
  },

  watch: {},

  mounted() {
    if (!this.extension) {
      this.$router.push('/marketplace');
    }

    this.metadata = demoMetadata[this.extension];

    if (!this.metadata) {
      return;
    }

    this.$store.dispatch('page/setHeader', {
      title:
        this.metadata?.LatestVersion.Labels['org.opencontainers.image.title'] ||
        this.extension,
    });

    this.extensionDetails = {
      name:
        this.metadata?.LatestVersion.Labels['org.opencontainers.image.title'] ||
        this.extension,
      icon:
        this.metadata?.LatestVersion.Labels[
          'com.docker.desktop.extension.icon'
        ] || '',
      links:
        JSON.parse(
          this.metadata?.LatestVersion.Labels[
            'com.docker.extension.additional-urls'
          ],
        ) || [],
      version:    this.metadata?.LatestVersion.Tag || [],
      platforms:  this.metadata?.LatestVersion.Platforms || [],
      categories: this.metadata?.Categories || [],
      lastUpdate: this.metadata?.UpdatedAt || [],
    };
  },

  methods: {
    resetBanners() {
      this.loading = true;
      this.error = null;
      this.response = null;
    },

    appInstallation(action) {
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
          this.response = this.t(`marketplace.banners.${ action }`, { name: this.extensionDetails.name });

          this.loading = false;

          if (action === 'uninstall') {
            this.isInstalled = false;
          } else {
            this.isInstalled = true;
          }
        }
      });
    },

    formatDate(dateString) {
      const date = dayjs(dateString);

      return date.format('DD/MM/YYYY');
    },
  },
};
</script>

<style lang="scss" scoped>
.extension {
  display: flex;
  align-items: flex-start;
  flex-direction: column;

  &-content {
    width: 100%;
    display: grid;
    grid-template-columns: 80fr 20fr; /* Set the widths of the columns */
    grid-gap: 60px;
    margin-top: 20px;

    img {
      display: flex;
      max-width: 100%;
    }

    &-sidebar {
      display: flex;
      flex-direction: column;

      hr {
        margin: -10px 0;
      }

      .btn {
        margin-bottom: 10px;
      }

      &-version {
        display: flex;
        flex-direction: column;
        gap: 28px;
        background: var(--default-hover-bg );
        border-radius: 5px;
        padding: 18px;

        &-element {
          display: flex;
          flex-direction: column;
          gap: 5px;

          & > p {
            font-weight: bold;
          }

          .badge {
            padding: 2px 5px;
            border-radius: 5px;
            background: var(--disabled-text);
            color: var(--default);
          }

          &-platforms {
            display: flex;
            flex-direction: row;
            gap: 5px;
          }
        }

        &-header {
          display: flex;
          flex-direction: row;
          align-items: center;

          img {
            width: 24px;
            height: 24px;
            margin-right: 10px;
          }
        }

        ul {
          list-style: none;
          padding: 0;
          margin: 0;

          li {
            display: flex;
            flex-direction: row;
            align-items: center;
            justify-content: space-between;
            padding: 2px 0;

            &:last-child {
              border-bottom: none;
            }
          }
        }
      }
    }
  }
}
</style>
