<router lang="yaml">
  name: General
</router>
<template>
  <div>
    <div class="general">
      <ul>
        <li>Project Status: <i>beta</i></li>
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
import { ipcRenderer } from 'electron';
import TelemetryOptIn from '@/components/TelemetryOptIn.vue';
import UpdateStatus from '@/components/UpdateStatus.vue';
import { defaultSettings } from '@/config/settings';

export default {
  name:       'General',
  title:      'General',
  components: { TelemetryOptIn, UpdateStatus },
  data() {
    return {
      settings:    defaultSettings,
      /** @type import('@/main/update').UpdateState | null */
      updateState: null,
      /** @type string */
      version:     '(checking...)',
    };
  },

  async mounted() {
    this.$store.dispatch(
      'page/setHeader',
      {
        title:       this.t('general.title'),
        description: this.t('general.description'),
      }
    );
    ipcRenderer.on('settings-update', this.onSettingsUpdate);
    ipcRenderer.on('update-state', this.onUpdateState);
    ipcRenderer.send('update-state');
    try {
      this.$data.settings = await ipcRenderer.invoke('settings-read');
    } catch (error) {
      console.error(`settings-read() failed with error ${ error }`);
    }
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
