<template>
  <div class="image-output-container">
    <images-output-window
      v-if="showOutput"
      :current-command="currentCommand"
      :image-output-culler="imageOutputCuller"
      @ok:process-end="onProcessEnd"
    >
      <template #loading="{ isLoading }">
        <banner
          v-if="isLoading"
        >
          <loading-indicator>
            {{ loadingText }}
          </loading-indicator>
        </banner>
      </template>
      <template #error="{ hasError }">
        <banner
          v-if="hasError"
          color="error"
        >
          {{ hasError }}
          <span class="icon icon-info icon-lg " />
          {{ errorText }}
        </banner>
      </template>
    </images-output-window>
    <images-scan-results
      v-if="isFinished && isFinishedWithSuccess"
      :image="image"
      :table-data="vulnerabilities"
    />
  </div>
</template>

<script>

import { Banner } from '@rancher/components';

import ImagesOutputWindow from '@pkg/components/ImagesOutputWindow.vue';
import ImagesScanResults from '@pkg/components/ImagesScanResults.vue';
import LoadingIndicator from '@pkg/components/LoadingIndicator.vue';
import getImageOutputCuller from '@pkg/utils/imageOutputCuller';
import { ipcRenderer } from '@pkg/utils/ipcRenderer';

export default {
  name: 'images-scan-details',

  components: {
    ImagesScanResults,
    ImagesOutputWindow,
    Banner,
    LoadingIndicator,
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
    isFinishedWithSuccess() {
      return this.isFinished && this.completionStatus;
    },
    imageManagerProcessFinishedWithFailure() {
      return this.isFinished && !this.completionStatus;
    },
    isFinished() {
      return !this.currentCommand;
    },
    showImageManagerOutput() {
      return this.keepImageManagerOutputWindowOpen;
    },
    showOutput() {
      return !this.isFinished && !this.isFinishedWithSuccess;
    },
    vulnerabilities() {
      const results = JSON.parse(this.jsonOutput)?.Results;

      // TODO: rancher-sandbox/rancher-desktop#2007
      return results
        ?.reduce((prev, curr) => {
          return [...prev, ...curr?.Vulnerabilities || []];
        }, [])
        ?.map(({ PkgName, VulnerabilityID, ...rest }) => {
          return {
            id: `${ PkgName }-${ VulnerabilityID }`,
            PkgName,
            VulnerabilityID,
            ...rest,
          };
        });
    },
    loadingText() {
      return this.t('images.scan.loadingText', { image: this.image }, true);
    },
    errorText() {
      return this.t('images.scan.errorText', { image: this.image }, true);
    },
  },

  mounted() {
    this.$store.dispatch(
      'page/setHeader',
      { title: this.t('images.scan.title', { image: this.$route.params.image }, true) },
    );

    ipcRenderer.on('ok:images-process-output', (_event, data) => {
      this.jsonOutput = data;
    });

    this.currentCommand = `scan image ${ this.image }`;
    this.scanImage();
  },

  methods: {
    scanImage() {
      this.startRunningCommand('trivy-image');
      ipcRenderer.send('do-image-scan', this.image);
    },
    startRunningCommand(command) {
      this.imageOutputCuller = getImageOutputCuller(command);
    },
    onProcessEnd(val) {
      this.completionStatus = val;
      this.currentCommand = null;
    },
  },
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
