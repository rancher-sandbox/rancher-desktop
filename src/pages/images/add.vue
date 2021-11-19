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
    </image-add-tabs>
    <template v-if="showOutput">
      <hr>
      <images-output-window
        ref="image-output-window"
        :current-command="currentCommand"
        :action="activeTab"
        :image-output-culler="imageOutputCuller"
        @ok:process-end="resetCurrentCommand"
        @ok:show="toggleOutput"
      />
    </template>
  </div>
</template>

<script>
import { ipcRenderer } from 'electron';

import ImageAddTabs from '@/components/ImageAddTabs.vue';
import ImagesFormAdd from '@/components/ImagesFormAdd.vue';
import ImagesOutputWindow from '@/components/ImagesOutputWindow.vue';
import getImageOutputCuller from '@/utils/imageOutputCuller';

export default {
  components: {
    ImageAddTabs,
    ImagesFormAdd,
    ImagesOutputWindow
  },
  data() {
    return {
      activeTab:                        'pull',
      currentCommand:                   null,
      imageToPull:                      '',
      imageOutputCuller:                null,
      showOutput:                       false
    };
  },
  computed: {
    imageToPullButtonDisabled() {
      return this.imageToPullTextFieldIsDisabled || !this.imageToPull;
    },
    imageToPullTextFieldIsDisabled() {
      return this.currentCommand;
    },
  },
  mounted() {
    this.$store.dispatch(
      'page/setHeader',
      { title: this.t('images.add.title') }
    );
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
      const imageName = this.imageToPull.trim();

      this.currentCommand = `pull ${ imageName }`;
      this.startRunningCommand('pull');
      ipcRenderer.send('do-image-pull', imageName);
      this.showOutput = true;
    },
    doBuildAnImage() {
      const imageName = this.imageToPull.trim();

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
    }
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

  .actions {
    margin-top: 15px;
    margin-bottom: 15px;
    display: flex;
    flex-flow: row-reverse;
  }
</style>
