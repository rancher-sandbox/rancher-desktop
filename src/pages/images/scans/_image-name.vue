<template>
  <div class="image-output-container">
    <div v-if="showImageOutput">
      <banner
        v-if="!imageManagerProcessIsFinished"
      >
        <loading-indicator>
          {{ loadingText }}
        </loading-indicator>
      </banner>
      <div
        v-else-if="imageManagerProcessFinishedWithFailure"
      >
        <banner color="error">
          <span class="icon icon-info icon-lg " />
          {{ errorText }}
        </banner>
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
    <images-scan-results
      v-if="imageManagerProcessIsFinished && imageManagerProcessFinishedWithSuccess"
      :image="image"
      :table-data="vulnerabilities"
      @close:output="closeOutputWindow"
    />
  </div>
</template>

<script>
import { ipcRenderer } from 'electron';

import LoadingIndicator from '@/components/LoadingIndicator.vue';
import Banner from '@/components/Banner.vue';
import getImageOutputCuller from '@/utils/imageOutputCuller';
import ImagesScanResults from '@/components/ImagesScanResults.vue';

export default {
  name: 'images-scan-details',

  components: {
    LoadingIndicator,
    Banner,
    ImagesScanResults
  },

  data() {
    return {
      image:                            this.$route.params.image,
      showImageOutput:                  true,
      imageManagerOutput:               '',
      imageOutputCuller:                null,
      keepImageManagerOutputWindowOpen: false,
      currentCommand:                   null,
      fieldToClear:                     '',
      completionStatus:                 false,
      jsonOutput:                       'null',
      postCloseOutputWindowHandler:     null,
    };
  },

  computed: {
    imageManagerProcessFinishedWithSuccess() {
      return this.imageManagerProcessIsFinished && this.completionStatus;
    },
    imageManagerProcessFinishedWithFailure() {
      return this.imageManagerProcessIsFinished && !this.completionStatus;
    },
    imageManagerProcessIsFinished() {
      return !this.currentCommand;
    },
    showImageManagerOutput() {
      return this.keepImageManagerOutputWindowOpen;
    },
    vulnerabilities() {
      const results = JSON.parse(this.jsonOutput)?.Results;

      return results
        ?.find((_val, i) => i === 0)
        ?.Vulnerabilities
        ?.map(({ PkgName, VulnerabilityID, ...rest }) => {
          return {
            id: `${ PkgName }-${ VulnerabilityID }`,
            PkgName,
            VulnerabilityID,
            ...rest
          };
        });
    },
    loadingText() {
      return this.t('images.scan.loadingText', { image: this.image }, true);
    },
    errorText() {
      return this.t('images.scan.errorText', { image: this.image }, true);
    }
  },

  mounted() {
    this.$store.dispatch(
      'page/setHeader',
      { title: this.t('images.scan.title', { image: this.$route.params.image }, true) }
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
    ipcRenderer.on('ok:images-process-output', (event, data) => {
      this.jsonOutput = data;
    });

    this.scanImage();
  },

  methods: {
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
      }
    },
    scanImage() {
      const taggedImageName = this.image;

      this.currentCommand = `scan image ${ taggedImageName }`;
      this.startRunningCommand('trivy-image');
      ipcRenderer.send('do-image-scan', taggedImageName);
    },
    startRunningCommand(command) {
      this.imageOutputCuller = getImageOutputCuller(command);
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
    handleProcessCancelled() {
      this.closeOutputWindow(null);
      this.currentCommand = null;
    },
    closeOutputWindow(event) {
      this.keepImageManagerOutputWindowOpen = false;
      if (this.postCloseOutputWindowHandler) {
        this.postCloseOutputWindowHandler();
        this.postCloseOutputWindowHandler = null;
      } else {
        this.imageManagerOutput = '';
      }
    },
  }
};
</script>

<style lang="scss" scoped>
  .image-output-container {
    padding-bottom: 1rem;
  }

  textarea#imageManagerOutput {
    font-family: monospace;
    font-size: smaller;

    .failure {
      border: 2px solid var(--error);
    }
  }
</style>
