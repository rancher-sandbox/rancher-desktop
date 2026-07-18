<template>
  <div>
    <div class="version">
      <version />
      <rd-checkbox
        v-if="updatePossible"
        v-model:value="updatesEnabled"
        class="updatesEnabled"
        :label="t('updateStatus.checkForUpdates')"
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
          <h3>{{ t('updateStatus.updateAvailable') }}</h3>
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
            {{ t('updateStatus.restartToApply') }}
          </p>
        </div>
        <details
          v-if="detailsMessage"
          class="release-notes"
        >
          <summary>{{ t('updateStatus.releaseNotes') }}</summary>
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
        <span v-else />
      </template>
    </card>
    <card
      v-else-if="unsupportedUpdateAvailable"
      :show-highlight-border="false"
    >
      <template #title>
        <div class="type-title">
          <h3>{{ t('updateStatus.unsupported.title') }}</h3>
        </div>
      </template>
      <template #body>
        <p>
          {{ t('updateStatus.unsupported.message') }}
        </p>
        <br>
        <!-- v-clean-html: the translated string embeds a link -->
        <p v-clean-html="t('updateStatus.unsupported.seeDocumentation')" />
      </template>
      <template #actions>
        <div />
      </template>
    </card>
  </div>
</template>

<script lang="ts">
import * as Components from '@rancher/components';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { defineComponent } from 'vue';

import Version from '@pkg/components/Version.vue';
import RdCheckbox from '@pkg/components/form/RdCheckbox.vue';
import { UpdateState } from '@pkg/main/update';

import type { PropType } from 'vue';

const { Card } = (Components as any).default ?? Components;

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
        return this.t('updateStatus.errorChecking');
      }
      if (!this.updateState?.info) {
        return '';
      }

      const { info, progress } = this.updateState;
      // Punctuation is hardcoded here (period, semicolon). Some locales use
      // different punctuation; revisit when locale coverage grows.
      const prefix = this.t('updateStatus.available', { version: info.version });

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

      return `${ prefix }; ${ this.t('updateStatus.downloading', { percent: String(percent), speed }) }`;
    },

    detailsMessage(): string | undefined {
      const markdown = this.updateState?.info?.releaseNotes;

      if (typeof markdown !== 'string') {
        return undefined;
      }
      // Here's the explanation of the following unorthodox typecast:
      // The signature of `marked.marked` is, with version 11:
      // marked(src: string, options?: MarkedOptions): string | Promise<string>
      // It returns a Promise<string> if `options.async` is true; otherwise, a string.
      const unsanitized = marked(markdown) as string;

      return DOMPurify.sanitize(unsanitized, { USE_PROFILES: { html: true } });
    },

    applyMessage(): string {
      return this.applying ? this.t('updateStatus.applyingUpdate') : this.t('updateStatus.restartNow');
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
