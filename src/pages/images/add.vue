<template>
  <div>
    <nuxt-link to="/images">
      Back to images
    </nuxt-link>
    <div>
      <div class="image-input">
        <labeled-input
          id="imageToPull"
          v-model="imageToPull"
          type="text"
          :disabled="!~imageToPullTextFieldIsDisabled"
          :placeholder="t('images.manager.input.pull.placeholder')"
          :label="t('images.manager.input.pull.label')"
        />
        <button
          class="btn role-primary btn-large"
          :disabled="imageToPullButtonDisabled"
          @click="doPullAnImage"
        >
          {{ t('images.manager.input.pull.button') }}
        </button>
      </div>
      <!-- <div v-if="false" class="labeled-input">
        <label for="imageToBuild">{{ t('images.manager.input.build.label') }}</label>
        <input
          id="imageToBuild"
          v-model="imageToBuild"
          :disabled="imageToBuildTextFieldIsDisabled"
          type="text"
          :placeholder="t('images.manager.input.build.placeholder')"
          class="input-sm inline"
        >
        <button
          class="btn role-tertiary"
          :disabled="imageToBuildButtonDisabled"
          @click="doBuildAnImage"
        >
          {{ t('images.manager.input.build.button') }}
        </button>
      </div> -->
      <div v-if="showImageManagerOutput">
        <hr>
        <button
          v-if="imageManagerProcessIsFinished"
          class="role-tertiary"
          @click="closeOutputWindow"
        >
          {{ t('images.manager.close') }}
        </button>
        <textarea
          id="imageManagerOutput"
          ref="outputWindow"
          v-model="imageManagerOutput"
          :class="{ success: imageManagerProcessFinishedWithSuccess, failure: imageManagerProcessFinishedWithFailure }"
          rows="10"
          readonly="true"
        />
      </div>
    </div>
  </div>
</template>

<script>
import { ipcRenderer } from 'electron';

import LabeledInput from '@/components/form/LabeledInput.vue';
import getImageOutputCuller from '@/utils/imageOutputCuller';

export default {
  components: { LabeledInput },
  data() {
    return {
      currentCommand:                   null,
      imageToPull:                      '',
      fieldToClear:                     '',
      keepImageManagerOutputWindowOpen: false,
      imageOutputCuller:                null,
      imageManagerOutput:               '',
      completionStatus:                 false,
      postCloseOutputWindowHandler:     null,
      mainWindowScroll:                 -1,
    };
  },
  computed: {
    imageToPullButtonDisabled() {
      return this.imageToPullTextFieldIsDisabled || !this.imageToPull;
    },
    imageToPullTextFieldIsDisabled() {
      return this.currentCommand || this.keepImageManagerOutputWindowOpen;
    },
    showImageManagerOutput() {
      return this.keepImageManagerOutputWindowOpen;
    },
    imageManagerProcessIsFinished() {
      return !this.currentCommand;
    },
    imageManagerProcessFinishedWithSuccess() {
      return this.imageManagerProcessIsFinished && this.completionStatus;
    },
    imageManagerProcessFinishedWithFailure() {
      return this.imageManagerProcessIsFinished && !this.completionStatus;
    },
  },
  mounted() {
    this.main = document.getElementsByTagName('main')[0];
    this.$store.dispatch(
      'page/setHeader',
      { title: 'Add Image' }
    );

    ipcRenderer.on('images-process-cancelled', (event) => {
      this.handleProcessCancelled();
    });
    ipcRenderer.on('images-process-ended', (event, status) => {
      this.handleProcessEnd(status);
    });
    ipcRenderer.on('images-process-output', (event, data, isStderr) => {
      this.appendImageManagerOutput(data, isStderr);
    });
  },
  methods: {
    startRunningCommand(command) {
      this.imageOutputCuller = getImageOutputCuller(command);
    },
    doPullAnImage() {
      const imageName = this.imageToPull.trim();

      this.currentCommand = `pull ${ imageName }`;
      this.fieldToClear = 'imageToPull';
      // this.postCloseOutputWindowHandler = () => this.scrollToImageOnSuccess(imageName);
      this.startRunningCommand('pull');
      ipcRenderer.send('do-image-pull', imageName);
    },
    appendImageManagerOutput(data, isStderr) {
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
        this.scrollToOutputWindow();
      }
    },
    scrollToOutputWindow() {
      if (this.main) {
        // move to the bottom
        this.$nextTick(() => {
          this.main.scrollTop = this.main.scrollHeight;
        });
      }
    },
    handleProcessEnd(status) {
      if (this.fieldToClear && status === 0) {
        this[this.fieldToClear] = ''; // JS way of doing indirection
        this.fieldToClear = '';
      }
      if (this.imageOutputCuller) {
        // Don't know what would make this null, but it happens on windows sometimes
        this.imageManagerOutput = this.imageOutputCuller.getProcessedData();
      }
      this.currentCommand = null;
      this.completionStatus = status === 0;
      if (!this.keepImageManagerOutputWindowOpen) {
        this.closeOutputWindow();
      }
    },
    closeOutputWindow(event) {
      this.keepImageManagerOutputWindowOpen = false;
      if (this.postCloseOutputWindowHandler) {
        this.postCloseOutputWindowHandler();
        this.postCloseOutputWindowHandler = null;
      } else {
        this.imageManagerOutput = '';
        if (this.mainWindowScroll >= 0) {
          this.$nextTick(() => {
            try {
              this.main.scrollTop = this.mainWindowScroll;
            } catch (e) {
              console.log(`Trying to reset scroll to ${ this.mainWindowScroll }, got error:`, e);
            }
            this.mainWindowScroll = -1;
          });
        }
      }
    },
    handleProcessCancelled() {
      this.closeOutputWindow(null);
      this.currentCommand = null;
    },
  }
};
</script>

<style lang="scss" scoped>
  div .image-input {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .image-input::v-deep .labeled-input {
    min-height: 42px;
    padding: 8px;
  }

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
</style>
