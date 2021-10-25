<template>
  <div>
    <image-add-tabs @click="updateTabs">
      <div class="image-input">
        <images-form-add
          :current-command="currentCommand"
          :keep-output-window-open="keepImageManagerOutputWindowOpen"
          :action="activeTab"
          @click="doImageAction"
        />
      </div>
    </image-add-tabs>
    <div v-if="showImageManagerOutput">
      <hr>
      <banner
        v-if="!imageManagerProcessIsFinished"
      >
        <loading-indicator>
          {{ loadingText }}
        </loading-indicator>
      </banner>
      <banner
        v-else-if="imageManagerProcessFinishedWithFailure"
        color="error"
      >
        <span class="icon icon-info icon-lg " />
        {{ errorText }}
      </banner>
      <banner
        v-else
        color="success"
      >
        <span class="icon icon-checkmark icon-lg " />
        {{ successText }}
      </banner>
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
        :class="{ success: imageManagerProcessFinishedWithSuccess, failure: imageManagerProcessFinishedWithFailure }"
        rows="10"
        readonly="true"
      />
    </div>
  </div>
</template>

<script>
import { ipcRenderer } from 'electron';

import ImageAddTabs from '@/components/ImageAddTabs.vue';
import Banner from '@/components/Banner.vue';
import ImagesFormAdd from '@/components/ImagesFormAdd.vue';
import LoadingIndicator from '@/components/LoadingIndicator.vue';
import getImageOutputCuller from '@/utils/imageOutputCuller';

export default {
  components: {
    ImageAddTabs,
    Banner,
    ImagesFormAdd,
    LoadingIndicator
  },
  data() {
    return {
      activeTab:                        'pull',
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
    actionCapitalized() {
      const action = this.activeTab;

      return `${ action?.charAt(0).toUpperCase() }${ action.slice(1) }`;
    },
    loadingText() {
      return this.t('images.add.loadingText', { action: this.actionCapitalized });
    },
    successText() {
      const pastTense = this.t(`images.add.action.pastTense.${ this.activeTab }`);

      return this.t('images.add.successText', { action: pastTense });
    },
    errorText() {
      return this.t('images.add.errorText', { action: this.activeTab, image: this.imageToPull }, true);
    }
  },
  mounted() {
    this.main = document.getElementsByTagName('main')[0];
    this.$store.dispatch(
      'page/setHeader',
      { title: this.t('images.add.title') }
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
      this.activeTab = tab.name;
    },
    updateTabs(tabName) {
      this.closeOutputWindow();
      this.activeTab = tabName;
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

  .actions {
    margin-top: 15px;
    margin-bottom: 15px;
    display: flex;
    flex-flow: row-reverse;
  }
</style>
