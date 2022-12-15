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
      :enabled="settings.updater"
      :update-state="updateState"
      :version="version"
      @enabled="onUpdateEnabled"
      @apply="onUpdateApply"
    />
    <hr>
    <telemetry-opt-in
      :telemetry="settings.telemetry"
      @updateTelemetry="updateTelemetry"
    />
    <hr>
    <div class="network-status">
      <span class="networkStatusInfo"><b>Network status:</b> {{ onlineStatus }}</span>
    </div>
  </div>
</template>

<script>

import TelemetryOptIn from '@pkg/components/TelemetryOptIn.vue';
import UpdateStatus from '@pkg/components/UpdateStatus.vue';
import { defaultSettings } from '@pkg/config/settings';
import { ipcRenderer } from '@pkg/utils/ipcRenderer';

export default {
  name:       'General',
  title:      'General',
  components: { TelemetryOptIn, UpdateStatus },
  data() {
    return {
      settings:      defaultSettings,
      /** @type import('@pkg/main/update').UpdateState | null */
      updateState:   null,
      /** @type string */
      version:       '(checking...)',
      networkStatus: true,
    };
  },

  computed: {
    onlineStatus() {
      return this.networkStatus ? 'online' : 'offline';
    },
  },

  mounted() {
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
      this.$data.networkStatus = status;
    });
    this.onNetworkUpdate(window.navigator.onLine);
    window.addEventListener('online', () => {
      this.onNetworkUpdate(true);
    });
    window.addEventListener('offline', () => {
      this.onNetworkUpdate(false);
    });
    // This event is triggered when the Preferences page is revealed (among other times).
    // If the network status changed while the window was closed, this will update it.
    window.addEventListener('pageshow', () => {
      this.onNetworkUpdate(window.navigator.onLine);
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
      ipcRenderer.invoke('settings-write', { updater: value });
    },
    onUpdateApply() {
      ipcRenderer.send('update-apply');
    },
    onUpdateState(event, state) {
      this.$data.updateState = state;
    },
    updateTelemetry(value) {
      ipcRenderer.invoke('settings-write', { telemetry: value });
    },
    onNetworkUpdate(status) {
      ipcRenderer.send('update-network-status', status);
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
