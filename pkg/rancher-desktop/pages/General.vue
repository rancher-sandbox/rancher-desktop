<template>
  <div class="general">
    <div>
      <ul>
        <!-- v-clean-html: the translated string embeds a link -->
        <li v-clean-html="t('general.projectDiscussions')" />
        <li class="project-links">
          <span>{{ t('general.projectLinks') }}</span>
          <a href="https://github.com/rancher-sandbox/rancher-desktop">{{ t('general.homepage') }}</a>
          <a href="https://github.com/rancher-sandbox/rancher-desktop/issues">{{ t('general.issues') }}</a>
        </li>
      </ul>
    </div>
    <hr>
    <update-status
      :enabled="settings.application.updater.enabled"
      :update-state="updateState"
      @apply="onUpdateApply"
    />
    <blog-feed />
  </div>
</template>

<script>

import BlogFeed from '@pkg/components/BlogFeed.vue';
import UpdateStatus from '@pkg/components/UpdateStatus.vue';
import { defaultSettings } from '@pkg/config/settings';
import { ipcRenderer } from '@pkg/utils/ipcRenderer';

export default {
  name:       'General',
  components: { BlogFeed, UpdateStatus },
  data() {
    return {
      settings:    defaultSettings,
      /** @type import('@pkg/main/update').UpdateState | null */
      updateState: null,
    };
  },

  mounted() {
    this.$store.dispatch(
      'page/setHeader',
      {
        titleKey:       'general.title',
        descriptionKey: 'general.description',
        icon:           'icon icon-rancher-desktop',
        action:         'AutoUpdateCheckbox',
      },
    );
    ipcRenderer.on('settings-update', this.onSettingsUpdate);
    ipcRenderer.on('update-state', this.onUpdateState);
    ipcRenderer.send('update-state');
    ipcRenderer.on('settings-read', this.onSettingsUpdate);
    ipcRenderer.send('settings-read');
  },

  beforeUnmount() {
    ipcRenderer.off('settings-update', this.onSettingsUpdate);
    ipcRenderer.off('settings-read', this.onSettingsUpdate);
    ipcRenderer.off('update-state', this.onUpdateState);
  },

  methods: {
    onSettingsUpdate(event, settings) {
      this.$data.settings = settings;
    },
    onUpdateApply() {
      ipcRenderer.send('update-apply');
    },
    onUpdateState(event, state) {
      this.$data.updateState = state;
    },
  },
};
</script>

<!-- Add "scoped" attribute to limit CSS to this component only -->
<style scoped lang="scss">
.general {
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
  // Fill the body so the blog feed can claim whatever height is left over.
  flex: 1;
  min-height: 0;

  ul {
    margin-bottom: 0;

    li {
      margin-bottom: .5em;
    }
  }
}

.project-links > * {
  margin-right: .25em;
}
</style>
