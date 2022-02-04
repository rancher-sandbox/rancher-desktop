<template>
  <div>
    <div class="version">
      <span class="versionInfo"><b>Version:</b> {{ version }}</span>
      <Checkbox
        v-if="updatePossible"
        v-model="updatesEnabled"
        class="updatesEnabled"
        label="Check for updates automatically"
      />
    </div>
    <card v-if="hasUpdate" ref="updateInfo" :show-highlight-border="false">
      <template #title>
        <div class="type-title">
          <h3>Update Available</h3>
        </div>
      </template>
      <template #body>
        <div ref="updateStatus">
          <p>
            {{ statusMessage }}
          </p>
          <p v-if="updateReady" class="update-notification">
            Restart the application to apply the update.
          </p>
        </div>
        <details v-if="detailsMessage" class="release-notes">
          <summary>Release Notes</summary>
          <div ref="releaseNotes" v-html="detailsMessage" />
        </details>
      </template>
      <template #actions>
        <button v-if="updateReady" ref="applyButton" class="btn role-secondary" :disabled="applying" @click="applyUpdate">
          {{ applyMessage }}
        </button>
        <span v-else></span>
      </template>
    </card>
  </div>
</template>

<script lang="ts">
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import Vue from 'vue';
import type { PropType } from 'vue';
import Component from 'vue-class-component';

import Checkbox from './form/Checkbox.vue';
import Card from '@/components/Card.vue';
import { UpdateState } from '@/main/update';

const UpdateStatusProps = Vue.extend({
  props: {
    enabled: {
      type:    Boolean,
      default: false,
    },
    updateState: {
      type:    Object as PropType<UpdateState | null>,
      default: null,
    },
    version: {
      type:    String,
      default: '(checking...)',
    },
  }
});

@Component({ components: { Card, Checkbox } })
class UpdateStatus extends UpdateStatusProps {
  applying = false;

  get updatesEnabled() {
    return this.enabled;
  }

  set updatesEnabled(value: boolean) {
    // We emit an event, but _don't_ set the prop here; we let the containing
    // page update our prop instead.
    this.$emit('enabled', value);
  }

  get updatePossible() {
    return !!this.updateState?.configured;
  }

  get hasUpdate() {
    return this.updatesEnabled && !!this.updateState?.available;
  }

  get updateReady() {
    return this.hasUpdate && !!this.updateState?.downloaded && !this.updateState?.error;
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

  get applyMessage() {
    return this.applying ? 'Applying update...' : 'Restart Now';
  }

  applyUpdate() {
    this.applying = true;
    this.$emit('apply');
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
