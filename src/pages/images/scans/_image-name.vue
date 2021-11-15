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
