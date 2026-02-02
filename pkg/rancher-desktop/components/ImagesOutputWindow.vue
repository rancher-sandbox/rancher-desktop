<script lang="ts">

import { Banner } from '@rancher/components';
import { defineComponent, PropType } from 'vue';

import LoadingIndicator from '@pkg/components/LoadingIndicator.vue';
import { ImageOutputCuller } from '@pkg/utils/imageOutputCuller';
import { ipcRenderer } from '@pkg/utils/ipcRenderer';

export default defineComponent({
  name: 'images-output-window',

  components: {
    Banner,
    LoadingIndicator,
  },

  props: {
    currentCommand: {
      type:    String as PropType<string | null>,
      default: null,
    },
    action: {
      type:    String,
      default: '',
    },
    imageOutputCuller: {
      type:    Object as PropType<ImageOutputCuller | undefined>,
      default: undefined,
    },
    showStatus: {
      type:    Boolean,
      default: true,
    },
    imageToPull: {
      type:    String as PropType<string | undefined>,
      default: undefined,
    },
  },

  data() {
    return {
      keepImageManagerOutputWindowOpen: false,
      postCloseOutputWindowHandler:     null as (() => void) | null,
      imageManagerOutput:               '',
      completionStatus:                 false,
    };
  },

  computed: {
    imageManagerProcessIsFinished(): boolean {
      return !this.currentCommand;
    },
    imageManagerProcessFinishedWithSuccess() {
      return this.imageManagerProcessIsFinished && this.completionStatus;
    },
    imageManagerProcessFinishedWithFailure() {
      return this.imageManagerProcessIsFinished && !this.completionStatus;
    },
    actionCapitalized(): string {
      const action = this.action;

      return `${ action?.charAt(0).toUpperCase() }${ action.slice(1) }`;
    },
    loadingText(): string {
      return this.t('images.add.loadingText', { action: this.actionCapitalized });
    },
    successText() {
      const pastTense = this.t(`images.add.action.pastTense.${ this.action }`);

      return this.t('images.add.successText', { action: pastTense });
    },
    errorText(): string {
      return this.t('images.add.errorText', { action: this.action, image: this.imageToPull }, true);
    },
  },

  mounted() {
    ipcRenderer.on('images-process-output', (_event, data) => {
      this.appendImageManagerOutput(data);
    });

    ipcRenderer.on('images-process-ended', (_event, status) => {
      this.handleProcessEnd(status);
    });

    ipcRenderer.on('images-process-cancelled', () => {
      this.handleProcessCancelled();
    });
  },

  methods: {
    closeOutputWindow() {
      this.keepImageManagerOutputWindowOpen = false;
      this.$emit('ok:show', this.keepImageManagerOutputWindowOpen);
      if (this.postCloseOutputWindowHandler) {
        this.postCloseOutputWindowHandler();
        this.postCloseOutputWindowHandler = null;
      } else {
        this.imageManagerOutput = '';
      }
    },
    appendImageManagerOutput(data: string) {
      if (!this.imageOutputCuller) {
        this.imageManagerOutput += data;
      } else {
        this.imageOutputCuller.addData(data);
        this.imageManagerOutput = this.imageOutputCuller.getProcessedData();
      }
      // Delay moving to the output-window until there's a reason to
      if (!this.keepImageManagerOutputWindowOpen) {
        if (!data?.trim()) {
        // Could be just a newline at the end of processing, so wait
          return;
        }
        this.keepImageManagerOutputWindowOpen = true;
        this.$emit('ok:show', this.keepImageManagerOutputWindowOpen);
      }
    },
    handleProcessEnd(status: number) {
      if (this.imageOutputCuller) {
        // Don't know what would make this null, but it happens on windows sometimes
        this.imageManagerOutput = this.imageOutputCuller.getProcessedData();
      }

      this.completionStatus = status === 0;
      this.$emit('ok:process-end', this.completionStatus);
      if (!this.keepImageManagerOutputWindowOpen) {
        this.closeOutputWindow();
      }
    },
    handleProcessCancelled() {
      this.closeOutputWindow();
      this.$emit('ok:process-end');
    },
  },
});
</script>

<template>
  <div>
    <template v-if="showStatus">
      <slot
        name="loading"
        :is-loading="!imageManagerProcessIsFinished"
      >
        <banner
          v-if="!imageManagerProcessIsFinished"
        >
          <loading-indicator>
            {{ loadingText }}
          </loading-indicator>
        </banner>
      </slot>
      <slot
        name="error"
        :has-error="imageManagerProcessFinishedWithFailure"
      >
        <banner
          v-if="imageManagerProcessFinishedWithFailure"
          color="error"
        >
          <span class="icon icon-info-circle icon-lg " />
          {{ errorText }}
        </banner>
      </slot>
      <slot
        name="success"
        :is-success="imageManagerProcessFinishedWithSuccess"
      >
        <banner
          v-if="imageManagerProcessFinishedWithSuccess"
          color="success"
        >
          <span class="icon icon-checkmark icon-lg " />
          {{ successText }}
        </banner>
      </slot>
    </template>
    <div
      v-if="imageManagerProcessIsFinished"
      class="actions"
    >
      <button
        class="role-tertiary btn-close"
        @click="closeOutputWindow"
      >
        {{ t('images.manager.close') }}
      </button>
    </div>
    <textarea
      id="imageManagerOutput"
      ref="outputWindow"
      v-model="imageManagerOutput"
      :class="{
        success: imageManagerProcessFinishedWithSuccess,
        failure: imageManagerProcessFinishedWithFailure,
      }"
      rows="10"
      readonly="true"
    />
  </div>
</template>

<style lang="scss" scoped>
  textarea#imageManagerOutput {
    font-family: monospace;
    font-size: smaller;
  }

  textarea#imageManagerOutput.success {
    border: 2px solid var(--success);
  }

  textarea#imageManagerOutput.failure {
    border: 2px solid var(--error);
  }

  .actions {
    margin-top: 15px;
    margin-bottom: 15px;
    display: flex;
    flex-flow: row-reverse;
  }

</style>
