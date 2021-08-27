<router lang="yaml">
  name: General
</router>
<template>
  <div>
    <div class="general">
      <h1>
        Welcome to Rancher Desktop
      </h1>
      <p>Rancher Desktop provides Kubernetes and image management through the use of a desktop application.</p>
      <ul>
        <li>Project Status: <i>alpha</i></li>
        <li>Project Discussions: #rancher-desktop in <a href="https://slack.rancher.io/">Rancher Users</a> Slack</li>
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
    />
    <hr>
    <telemetry-opt-in
      :telemetry="settings.telemetry"
      @updateTelemetry="updateTelemetry"
    />
  </div>
</template>

<script>
import TelemetryOptIn from '@/components/TelemetryOptIn.vue';
import UpdateStatus from '@/components/UpdateStatus.vue';
const { ipcRenderer } = require('electron');

export default {
  name:       'General',
  title:      'General',
  components: { TelemetryOptIn, UpdateStatus },
  data() {
    return {
      /** @type Settings */
      settings:    ipcRenderer.sendSync('settings-read'),
      /** @type import('@/main/update').UpdateState | null */
      updateState: null,
      /** @type string */
      version:     '(checking...)',
    };
  },

  async mounted() {
    ipcRenderer.on('settings-update', this.onSettingsUpdate);
    ipcRenderer.on('update-state', this.onUpdateState);
    ipcRenderer.send('update-state');
    try {
      this.$data.version = await ipcRenderer.invoke('get-app-version');
    } catch (error) {
      console.error(`get-app-version() failed with error ${ error }`);
    }
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
    onUpdateState(event, state) {
      this.$data.updateState = state;
    },
    updateTelemetry(value) {
      ipcRenderer.invoke('settings-write', { telemetry: value });
    },
  }
};
</script>

<!-- Add "scoped" attribute to limit CSS to this component only -->
<style scoped>

.general li {
  margin-bottom: .5em;
}

</style>
