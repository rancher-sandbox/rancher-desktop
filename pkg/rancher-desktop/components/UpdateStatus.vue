<template>
  <div>
    <div class="version">
      <version />
      <rd-checkbox
        v-if="updatePossible"
        v-model="updatesEnabled"
        class="updatesEnabled"
        label="Check for updates automatically"
        :is-locked="autoUpdateLocked"
      />
    </div>
    <card
      v-if="hasUpdate"
      ref="updateInfo"
      :show-highlight-border="false"
    >
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
          <p
            v-if="updateReady"
            class="update-notification"
          >
            Restart the application to apply the update.
          </p>
        </div>
        <details
          v-if="detailsMessage"
          class="release-notes"
        >
          <summary>Release Notes</summary>
          <div
            ref="releaseNotes"
            v-html="detailsMessage"
          />
        </details>
      </template>
      <template #actions>
        <button
          v-if="updateReady"
          ref="applyButton"
          class="btn role-secondary"
          :disabled="applying"
          @click="applyUpdate"
        >
          {{ applyMessage }}
        </button>
        <span v-else></span>
      </template>
    </card>
    <card
      v-else-if="unsupportedUpdateAvailable"
      :show-highlight-border="false"
    >
      <template #title>
        <div class="type-title">
          <h3>Latest Version Not Supported</h3>
        </div>
      </template>
      <template #body>
        <p>
          A newer version of Rancher Desktop is available, but not supported on your system.
        </p>
        <br>
        <p>
          For more information please see
          <a href="https://docs.rancherdesktop.io/getting-started/installation">the installation documentation</a>.
        </p>
      </template>
      <template #actions>
        <div></div>
      </template>
    </card>
  </div>
</template>

<script lang="ts">
import { Card } from '@rancher/components';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { defineComponent } from 'vue';

import Version from '@pkg/components/Version.vue';
import RdCheckbox from '@pkg/components/form/RdCheckbox.vue';
import { UpdateState } from '@pkg/main/update';

import type { PropType } from 'vue';

export default defineComponent({
  name:       'update-status',
  components: {
    Version, Card, RdCheckbox,
  },

  props: {
    enabled: {
      type:    Boolean,
      default: false,
    },
    updateState: {
      type:    Object as PropType<UpdateState | null>,
      default: null,
    },
    locale: {
      type:    String,
      default: undefined,
    },
    isAutoUpdateLocked: {
      type:    Boolean,
      default: false,
    },
  },

  data() {
    return { applying: false };
  },

  computed: {
    updatesEnabled: {
      get(): boolean {
        return this.enabled;
      },
      set(value: boolean) {
        // We emit an event, but _don't_ set the prop here; we let the containing
        // page update our prop instead.
        this.$emit('enabled', value);
      },
    },

    updatePossible(): boolean {
      return !!this.updateState?.configured;
    },

    hasUpdate(): boolean {
      return this.updatesEnabled && !!this.updateState?.available;
    },

    updateReady(): boolean {
      return this.hasUpdate && !!this.updateState?.downloaded && !this.updateState?.error;
    },

    statusMessage(): string {
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
      const speed = Intl.NumberFormat(this.locale, {
        style:       'unit',
        unit:        'byte-per-second',
        unitDisplay: 'narrow',
        notation:    'compact',
      }).format(progress.bytesPerSecond);

      return `${ prefix }; downloading... (${ percent }%, ${ speed })`;
    },

    detailsMessage(): string | undefined {
      const markdown = this.updateState?.info?.releaseNotes;

      if (typeof markdown !== 'string') {
        return undefined;
      }
      // Here's the explanation of the following unorthodox typecast:
      // The signature of `marked.marked` is, with version 11:
      // marked(src: string, options?: MarkedOptions): string | Promise<string>
      // It returns a Promise<string> if `options.async` is true, otherwise a string.
      const unsanitized = marked(markdown) as string;

      return DOMPurify.sanitize(unsanitized, { USE_PROFILES: { html: true } });
    },

    applyMessage(): string {
      return this.applying ? 'Applying update...' : 'Restart Now';
    },

    unsupportedUpdateAvailable(): boolean {
      return !this.hasUpdate && !!this.updateState?.info?.unsupportedUpdateAvailable;
    },

    autoUpdateLocked(): boolean {
      return this.isAutoUpdateLocked;
    },
  },

  methods: {
    applyUpdate() {
      this.applying = true;
      this.$emit('apply');
    },
  },
});

</script>

<style lang="scss" scoped>
  .version {
    display: flex;
    justify-content: space-between
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
