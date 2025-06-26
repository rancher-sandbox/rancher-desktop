<template>
  <div class="general">
    <div>
      <ul>
        <li>Project Discussions: <b>#rancher-desktop</b> in <a href="https://slack.rancher.io/">Rancher Users</a> Slack</li>
        <li class="project-links">
          <span>Project Links:</span>
          <a href="https://github.com/rancher-sandbox/rancher-desktop">Homepage</a>
          <a href="https://github.com/rancher-sandbox/rancher-desktop/issues">Issues</a>
        </li>
      </ul>
    </div>
    <hr>
    <update-status
      :enabled="settings.application.updater.enabled"
      :update-state="updateState"
      :is-auto-update-locked="autoUpdateLocked"
      @enabled="onUpdateEnabled"
      @apply="onUpdateApply"
    />
    <hr>
    <telemetry-opt-in
      :telemetry="settings.application.telemetry.enabled"
      :is-telemetry-locked="telemetryLocked"
      @updateTelemetry="updateTelemetry"
    />
    <hr>
    <div class="network-status">
      <network-status />
    </div>
  </div>
</template>

<script>

import _ from 'lodash';

import NetworkStatus from '@pkg/components/NetworkStatus.vue';
import TelemetryOptIn from '@pkg/components/TelemetryOptIn.vue';
import UpdateStatus from '@pkg/components/UpdateStatus.vue';
import { defaultSettings } from '@pkg/config/settings';
import { ipcRenderer } from '@pkg/utils/ipcRenderer';

export default {
  name:       'General',
  title:      'General',
  components: {
    NetworkStatus, TelemetryOptIn, UpdateStatus,
  },
  data() {
    return {
      settings:         defaultSettings,
      telemetryLocked:  null,
      autoUpdateLocked: null,
      /** @type import('@pkg/main/update').UpdateState | null */
      updateState:      null,
    };
  },

  mounted() {
    this.$store.dispatch(
      'page/setHeader',
      {
        title:       this.t('general.title'),
        description: this.t('general.description'),
        icon:        'icon icon-rancher-desktop',
      },
    );
    ipcRenderer.on('settings-update', this.onSettingsUpdate);
    ipcRenderer.on('update-state', this.onUpdateState);
    ipcRenderer.send('update-state');
    ipcRenderer.on('settings-read', (event, settings) => {
      this.$data.settings = settings;
    });
    ipcRenderer.send('settings-read');
    ipcRenderer.invoke('get-locked-fields').then((lockedFields) => {
      this.$data.telemetryLocked = _.get(lockedFields, 'application.telemetry.enabled');
      this.$data.autoUpdateLocked = _.get(lockedFields, 'application.updater.enabled');
    });
  },

  beforeDestroy() {
    ipcRenderer.off('settings-update', this.onSettingsUpdate);
    ipcRenderer.off('update-state', this.onUpdateState);
  },

  methods: {
    onSettingsUpdate(event, settings) {
      this.$data.settings = settings;
    },
    onUpdateEnabled(value) {
      ipcRenderer.invoke('settings-write', { application: { updater: { enabled: value } } });
    },
    onUpdateApply() {
      ipcRenderer.send('update-apply');
    },
    onUpdateState(event, state) {
      this.$data.updateState = state;
    },
    updateTelemetry(value) {
      ipcRenderer.invoke('settings-write', { application: { telemetry: { enabled: value } } });
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
