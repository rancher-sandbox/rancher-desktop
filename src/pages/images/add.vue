<template>
  <div>
    <image-add-tabs @click="(active) => currentComponent = active">
      <div class="image-input">
        <component
          :is="componentToLoad"
          :current-command="currentCommand"
          :keep-output-window-open="keepImageManagerOutputWindowOpen"
          @click="doImageAction"
        />
      </div>
    </image-add-tabs>
    <div v-if="showImageManagerOutput">
      <hr>
      <banner
        v-if="!imageManagerProcessIsFinished"
      >
        <section class="loading-indicator">
          <span class="icon icon-spinner icon-lg loading-icon" /> {{ loadingText }}
        </section>
      </banner>
      <banner
        v-else-if="imageManagerProcessFinishedWithFailure"
        color="error"
      >
        <span class="icon icon-info icon-lg " />
        Error trying to {{ currentComponent }} {{ imageToPull }} - see console output for more information
      </banner>
      <banner
        v-else
        color="success"
      >
        <span class="icon icon-checkmark icon-lg " />
        {{ successText }}
      </banner>
      <textarea
        id="imageManagerOutput"
        ref="outputWindow"
        v-model="imageManagerOutput"
        :class="{ success: imageManagerProcessFinishedWithSuccess, failure: imageManagerProcessFinishedWithFailure }"
        rows="10"
        readonly="true"
      />
      <div class="actions">
        <button
          v-if="imageManagerProcessIsFinished"
          class="role-tertiary btn-close"
          @click="closeOutputWindow"
        >
          {{ t('images.manager.close') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script>
import { ipcRenderer } from 'electron';

import LabeledInput from '@/components/form/LabeledInput.vue';
import ImageAddTabs from '@/components/ImageAddTabs.vue';
import Banner from '@/components/Banner.vue';
import getImageOutputCuller from '@/utils/imageOutputCuller';

export default {
  components: {
    LabeledInput,
    ImageAddTabs,
    Banner,
  },
  data() {
    return {
      currentComponent:                 'pull',
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
    componentToLoad() {
      const currentComponent = this.currentComponent;

      return {
        pull:  () => import(`@/components/ImageAddButtonPull.vue`),
        build: () => import(`@/components/ImageAddButtonBuild.vue`)
      }[currentComponent];
    },
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
    actionCapitalized() {
      const action = this.currentComponent;

      return `${ action?.charAt(0).toUpperCase() }${ action.slice(1) }`;
    },
    loadingText() {
      return `${ this.actionCapitalized }ing Image...`;
    },
    successText() {
      const pastTense = this.currentComponent === 'build' ? this.actionCapitalized.replace('d', 't') : `${ this.actionCapitalized }ed`;

      return `${ pastTense } image`;
    }
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
    detectChange({ tab }) {
      this.currentComponent = tab.name;
    },
    startRunningCommand(command) {
      this.imageOutputCuller = getImageOutputCuller(command);
    },
    doImageAction({ action, image }) {
      this.imageToPull = image;
      if (action === 'pull') {
        this.doPullAnImage();
      }

      if (action === 'build') {
        this.doBuildAnImage();
      }
    },
    doPullAnImage() {
      const imageName = this.imageToPull.trim();

      this.currentCommand = `pull ${ imageName }`;
      this.fieldToClear = 'imageToPull';
      // this.postCloseOutputWindowHandler = () => this.scrollToImageOnSuccess(imageName);
      this.startRunningCommand('pull');
      ipcRenderer.send('do-image-pull', imageName);
    },
    doBuildAnImage() {
      const imageName = this.imageToPull.trim();

      this.currentCommand = `build ${ imageName }`;
      this.fieldToClear = 'imageToBuild';
      // this.postCloseOutputWindowHandler = () => this.scrollToImageOnSuccess(imageName);
      this.startRunningCommand('build');
      ipcRenderer.send('do-image-build', imageName);
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

  .loading-indicator {
    color: var(--primary);
  }

  .loading-icon {
    animation:spin 4s linear infinite;
  }

  @keyframes spin {
    100% {
      transform: rotate(360deg);
    }
  }

  .actions {
    margin-top: 15px;
    display: flex;
    flex-flow: row-reverse;
  }

  .action-tabs::v-deep li.tab {
    margin-right: 0;
    padding-right: 0;
    border-bottom: 1px solid;
    border-color: var(--muted);
    padding-bottom: 7px;

    A {
      color: var(--muted);
    }
  }

  .action-tabs::v-deep .tabs .tab.active {
    border-color: var(--primary);
    background-color: transparent;

    A {
      color: var(--link);
    }
  }

  .action-tabs::v-deep ul {
    border-bottom: 1px solid;
    border-color: var(--muted);
  }

  .action-tabs::v-deep .tab-container {
    background-color: transparent;
    margin-top: 1rem;
  }
</style>
