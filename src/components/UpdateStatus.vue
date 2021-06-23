<template>
  <div>
    <div class="versionInfo">
      <p><b>Version:</b> {{ version }}</p>
    </div>
    <card v-if="hasUpdate" :show-highlight-border="false" :show-actions="false">
      <template #title>
        <div class="type-title">
          <h3>Update Available</h3>
        </div>
      </template>
      <template #body>
        <p v-text="statusMessage" />
        <details v-if="detailsMessage">
          <summary>Release Notes</summary>
          <pre v-text="detailsMessage" />
        </details>
      </template>
    </card>
  </div>
</template>

<script lang="ts">
import Electron, { ipcRenderer } from 'electron';
import Vue from 'vue';
import Component from 'vue-class-component';

import Card from '@/components/Card.vue';
import { UpdateState } from '@/main/update';

@Component({ components: { Card } })
class UpdateStatus extends Vue {
  version = '(checking...)';
  updateState: UpdateState | null = null;

  onUpdateState(_: Electron.IpcRendererEvent, state: UpdateState) {
    this.updateState = state;
  }

  _onUpdateState?: (_: Electron.IpcRendererEvent, info: UpdateState) => void;

  get hasUpdate() {
    return !!this.updateState?.available;
  }

  get statusMessage(): string {
    if (this.updateState?.error) {
      return 'There was an error checking for updates.';
    }
    if (!this.updateState?.info) {
      return '';
    }

    const { downloaded, info, progress } = this.updateState;
    const prefix = `An update to version ${ info.version } is available`;

    if (downloaded) {
      return `${ prefix }. Restart the application to apply the update.`;
    }
    if (!progress) {
      return `${ prefix }.`;
    }

    const percent = Math.floor(progress.percent);
    const speed = Intl.NumberFormat(undefined, {
      style:       'unit',
      unit:        'byte-per-second',
      unitDisplay: 'narrow',
      notation:    'compact',
    }).format(progress.bytesPerSecond);

    return `${ prefix }; downloading... (${ percent }%, ${ speed })`;
  }

  get detailsMessage() {
    return this.updateState?.info?.releaseNotes;
  }

  async mounted() {
    this._onUpdateState ||= this.onUpdateState.bind(this);

    ipcRenderer.on('update-state', this._onUpdateState);
    ipcRenderer.send('update-state');

    try {
      this.version = await ipcRenderer.invoke('get-app-version');
    } catch (error) {
      console.error(`get-app-version() failed with error ${ error }`);
    }
  }

  beforeDestroy() {
    if (this._onUpdateState) {
      ipcRenderer.removeListener('update-state', this._onUpdateState);
    }
  }
}

export default UpdateStatus;
</script>
