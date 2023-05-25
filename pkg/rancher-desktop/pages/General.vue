<router lang="yaml">
  name: General
</router>
<template>
  <div>
    <div class="general">
      <ul>
        <li>Project Discussions: <b>#rancher-desktop</b> in <a href="https://slack.rancher.io/">Rancher Users</a> Slack</li>
        <li>
          Project Links:
          <a href="https://github.com/rancher-sandbox/rancher-desktop">Homepage</a>
          <a href="https://github.com/rancher-sandbox/rancher-desktop/issues">Issues</a>
        </li>
      </ul>
    </div>
    <hr>
    <update-status
      :enabled="settings.application.updater.enabled"
      :update-state="updateState"
      :version="version"
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
      <span class="networkStatusInfo"><b>Network status:</b> {{ networkStatusLabel }}</span>
    </div>
  </div>
</template>

<script>
import _ from 'lodash';

import TelemetryOptIn from '@pkg/components/TelemetryOptIn.vue';
import UpdateStatus from '@pkg/components/UpdateStatus.vue';
import { defaultSettings } from '@pkg/config/settings';
import { ipcRenderer } from '@pkg/utils/ipcRenderer';
import { networkStatus } from '@pkg/utils/networks';

export default {
  name:       'General',
  title:      'General',
  components: { TelemetryOptIn, UpdateStatus },
  data() {
    return {
      settings:         defaultSettings,
      telemetryLocked:  null,
      autoUpdateLocked: null,
      /** @type import('@pkg/main/update').UpdateState | null */
      updateState:      null,
      /** @type string */
      version:          '(checking...)',
      networkStatus:    true,
    };
  },

  computed: {
    networkStatusLabel() {
      return this.networkStatus ? networkStatus.CONNECTED : networkStatus.OFFLINE;
    },
  },

  mounted() {
    this.onNetworkStatusUpdate(window.navigator.onLine);

    this.$store.dispatch(
      'page/setHeader',
      {
        title:       this.t('general.title'),
        description: this.t('general.description'),
      },
    );
    ipcRenderer.on('settings-update', this.onSettingsUpdate);
    ipcRenderer.on('update-state', this.onUpdateState);
    ipcRenderer.send('update-state');
    ipcRenderer.on('settings-read', (event, settings) => {
      this.$data.settings = settings;
    });
    ipcRenderer.send('settings-read');
    ipcRenderer.on('get-app-version', (event, version) => {
      this.$data.version = version;
    });
    ipcRenderer.send('get-app-version');
    ipcRenderer.on('update-network-status', (event, status) => {
      this.onNetworkStatusUpdate(status);
    });
    ipcRenderer.invoke('get-locked-fields').then((lockedFields) => {
      this.$data.telemetryLocked = _.get(lockedFields, 'application.telemetry.enabled');
      this.$data.autoUpdateLocked = _.get(lockedFields, 'application.updater.enabled');
    });
    window.addEventListener('online', () => {
      this.onNetworkStatusUpdate(true);
    });
    window.addEventListener('offline', () => {
      this.onNetworkStatusUpdate(false);
    });
    // This event is triggered when the Preferences page is revealed (among other times).
    // If the network status changed while the window was closed, this will update it.
    window.addEventListener('pageshow', () => {
      this.onNetworkStatusUpdate(window.navigator.onLine);
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
    onNetworkStatusUpdate(status) {
      this.$data.networkStatus = status;
    },
  },
};
</script>

<!-- Add "scoped" attribute to limit CSS to this component only -->
<style scoped>

.general li {
  margin-bottom: .5em;
}

</style>
