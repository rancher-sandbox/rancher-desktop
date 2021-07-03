<template>
  <div>
    <div class="version">
      <span class="versionInfo"><b>Version:</b> {{ version }}</span>
      <Checkbox
        v-model="updatesEnabled"
        class="updatesEnabled"
        label="Check for updates automatically"
      />
    </div>
    <card v-if="hasUpdate" :show-highlight-border="false" :show-actions="false">
      <template #title>
        <div class="type-title">
          <h3>Update Available</h3>
        </div>
      </template>
      <template #body>
        <p>
          {{ statusMessage }}
          <span v-if="updateReady" class="update-notification">
            Restart the application to apply the update.</span>
        </p>
        <details v-if="detailsMessage" class="release-notes">
          <summary>Release Notes</summary>
          <div v-html="detailsMessage" />
        </details>
      </template>
    </card>
  </div>
</template>

<script lang="ts">
import DOMPurify from 'dompurify';
import Electron, { ipcRenderer } from 'electron';
import marked from 'marked';
import Vue from 'vue';
import Component from 'vue-class-component';

import Card from '@/components/Card.vue';
import { UpdateState } from '@/main/update';
import Checkbox from './form/Checkbox.vue';

const UpdateStatusProps = Vue.extend({
  props: {
    enabled: {
      type:    Boolean,
      default: false,
    },
  }
});

@Component({ components: { Card, Checkbox } })
class UpdateStatus extends UpdateStatusProps {
  version = '(checking...)';
  updateState: UpdateState | null = null;

  onUpdateState(_: Electron.IpcRendererEvent, state: UpdateState) {
    this.updateState = state;
  }

  _onUpdateState?: (_: Electron.IpcRendererEvent, info: UpdateState) => void;

  get updatesEnabled() {
    return this.enabled;
  }

  set updatesEnabled(value: boolean) {
    // We emit an event, but _don't_ set the prop here; we let the containing
    // page update our prop instead.
    this.$emit('enabled', value);
  }

  get hasUpdate() {
    return this.updatesEnabled && !!this.updateState?.available;
  }

  get updateReady() {
    return this.hasUpdate && this.updateState?.downloaded;
  }

  get statusMessage(): string {
    if (this.updateState?.error) {
      return 'There was an error checking for updates.';
    }
    if (!this.updateState?.info) {
      return '';
    }

    const { info, progress } = this.updateState;
    const prefix = `An update to version ${ info.version } is available`;

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
    const markdown = this.updateState?.info?.releaseNotes;

    if (typeof markdown !== 'string') {
      return undefined;
    }
    const unsanitized = marked(markdown);

    return DOMPurify.sanitize(unsanitized, { USE_PROFILES: { html: true } });
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

<style lang="scss" scoped>
  .version {
    display: flex;
  }
  .versionInfo {
    flex: 1;
  }
  .update-notification {
    font-weight: 900;
  }
  .release-notes > summary {
    margin: 1em;
  }
  .release-notes > div {
    margin-left: 2em;
    margin-right: 1em;
  }
</style>

<style lang="scss">
  .release-notes p {
    margin: 1em 0px;
  }
</style>
