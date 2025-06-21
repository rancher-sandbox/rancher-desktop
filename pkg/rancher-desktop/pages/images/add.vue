<template>
  <div>
    <image-add-tabs @click="updateTabs">
      <div class="image-input">
        <images-form-add
          :current-command="currentCommand"
          :keep-output-window-open="showOutput"
          :action="activeTab"
          @click="doImageAction"
        />
      </div>
      <alert
        v-if="allowedImagesAlert"
        :icon="'icon-info-circle'"
        :banner-text="allowedImagesAlert"
        :color="'info'"
      />
    </image-add-tabs>
    <template v-if="showOutput">
      <hr>
      <images-output-window
        ref="image-output-window"
        :current-command="currentCommand"
        :action="activeTab"
        :image-output-culler="imageOutputCuller"
        :image-to-pull="imageToPull"
        @ok:process-end="resetCurrentCommand"
        @ok:show="toggleOutput"
      />
    </template>
  </div>
</template>

<script>

import Alert from '@pkg/components/Alert.vue';
import ImageAddTabs from '@pkg/components/ImageAddTabs.vue';
import ImagesFormAdd from '@pkg/components/ImagesFormAdd.vue';
import ImagesOutputWindow from '@pkg/components/ImagesOutputWindow.vue';
import getImageOutputCuller from '@pkg/utils/imageOutputCuller';
import { ipcRenderer } from '@pkg/utils/ipcRenderer';

export default {
  components: {
    Alert,
    ImageAddTabs,
    ImagesFormAdd,
    ImagesOutputWindow,
  },
  data() {
    return {
      activeTab:              'pull',
      currentCommand:         null,
      imageToPull:            '',
      imageOutputCuller:      null,
      showOutput:             false,
      isAllowedImagesEnabled: false,
    };
  },
  computed: {
    imageToPullButtonDisabled() {
      return this.imageToPullTextFieldIsDisabled || !this.imageToPull;
    },
    imageToPullTextFieldIsDisabled() {
      return this.currentCommand;
    },
    allowedImagesAlert() {
      return this.activeTab === 'pull' && this.isAllowedImagesEnabled ? this.t('allowedImages.alert') : '';
    },
  },
  mounted() {
    this.$store.dispatch(
      'page/setHeader',
      { title: this.t('images.add.title') },
    );
    ipcRenderer.once('settings-read', (_event, settings) => {
      this.enableAllowedImages(settings);
    });
    ipcRenderer.on('settings-update', (_event, settings) => {
      this.enableAllowedImages(settings);
    });
    ipcRenderer.send('settings-read');
  },
  methods: {
    updateTabs(tabName) {
      this.showOutput = false;
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
      const imageName = this.imageToPull;

      this.currentCommand = `pull ${ imageName }`;
      this.startRunningCommand('pull');
      ipcRenderer.send('do-image-pull', imageName);
      this.showOutput = true;
    },
    doBuildAnImage() {
      const imageName = this.imageToPull;

      this.currentCommand = `build ${ imageName }`;
      this.startRunningCommand('build');
      ipcRenderer.send('do-image-build', imageName);
      this.showOutput = true;
    },
    resetCurrentCommand() {
      this.currentCommand = null;
    },
    toggleOutput(val) {
      this.showOutput = val;
    },
    enableAllowedImages(settings) {
      this.isAllowedImagesEnabled = settings.containerEngine.allowedImages.enabled;
    },
  },
};
</script>

<style lang="scss" scoped>
  div .image-input {
    display: flex;
    align-items: center;
    gap: 16px;
    padding-top: 0.5rem;
    margin-left: 1px;
  }

  .image-input :deep(.labeled-input) {
    min-height: 42px;
    padding: 8px;
  }

  .actions {
    margin-top: 15px;
    margin-bottom: 15px;
    display: flex;
    flex-flow: row-reverse;
  }
</style>
