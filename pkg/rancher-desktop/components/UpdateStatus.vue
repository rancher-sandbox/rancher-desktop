<template>
  <div class="update-status">
    <template v-if="hasUpdate">
      <h3>{{ t('updateStatus.updateAvailable') }}</h3>
      <card
        ref="updateInfo"
        :show-highlight-border="false"
      >
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
    </template>
    <template v-else-if="unsupportedUpdateAvailable">
      <h3>{{ t('updateStatus.unsupported.title') }}</h3>
      <card :show-highlight-border="false">
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
    </template>
  </div>
</template>

<script lang="ts">
import * as Components from '@rancher/components';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { defineComponent } from 'vue';

import { UpdateState } from '@pkg/main/update';

import type { PropType } from 'vue';

const { Card } = (Components as any).default ?? Components;

export default defineComponent({
  name:       'update-status',
  components: { Card },

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
  },

  data() {
    return { applying: false };
  },

  computed: {
    hasUpdate(): boolean {
      return this.enabled && !!this.updateState?.available;
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
  // Shrink so long release notes scroll inside the card, not push the blog off.
  .update-status {
    display: flex;
    flex-direction: column;
    min-height: 0;

    // Match the blog feed's heading above its box.
    h3 {
      margin-bottom: 0.75rem;
    }
  }

  // Keep the card tall enough to read the notes once they are open.
  .update-status:has(.release-notes[open]) {
    min-height: 14rem;
  }

  :deep(.card-container) {
    // Drop the Card's grid margin so the box aligns with the blog box.
    margin-left: 0;
    margin-right: 0;
    // Fill and shrink past the Card's 100px minimum, so the body scrolls.
    flex: 1;
    min-height: 0;
  }

  // Hide the empty title and <hr> the Card draws with no title slot.
  :deep(.card-title),
  :deep(.card-wrap > hr) {
    display: none;
  }

  // card-wrap is a plain block here; make it a column so the body can scroll.
  :deep(.card-wrap) {
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  // Scroll long notes inside the card; anchor to the top (the Card centres it).
  :deep(.card-body) {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    justify-content: flex-start;
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
