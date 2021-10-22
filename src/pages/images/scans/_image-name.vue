<template>
  <div>
    <div v-if="showImageOutput">
      <banner
        v-if="!imageManagerProcessIsFinished"
      >
        <loading-indicator>
          Scanning {{ image }}...
        </loading-indicator>
      </banner>
      <banner
        v-else-if="imageManagerProcessFinishedWithFailure"
        color="error"
      >
        <span class="icon icon-info icon-lg " />
        FAIL
      </banner>
      <banner
        v-else
        color="success"
      >
        <span class="icon icon-checkmark icon-lg " />
        SUCCESS
      </banner>
      <!-- <div
        v-if="imageManagerProcessIsFinished"
        class="actions"
      >
        <button
          class="role-tertiary btn-close"
          @click="closeOutputWindow"
        >
          {{ t('images.manager.close') }}
        </button>
      </div> -->
      <textarea
        id="imageManagerOutput"
        ref="outputWindow"
        v-model="imageManagerOutput"
        :class="{ success: imageManagerProcessFinishedWithSuccess, failure: imageManagerProcessFinishedWithFailure }"
        rows="10"
        readonly="true"
      />
    </div>
    <images-scan-results
      v-if="showImageManagerOutput && fromScan"
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
      fromScan:                         false,
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
    escapedJson() {
      return this.jsonOutput?.replaceAll('\\\'', '\'');
    },
    vulnerabilities() {
      const results = JSON.parse(this.escapedJson)?.Results;

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
    }
  },

  mounted() {
    this.$store.dispatch(
      'page/setHeader',
      {
        title:  `${ this.$route.params.image } scan detail`,
        action: () => import(`@/components/ImagesScanDetailButtonExport.vue`)
      }
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

      this.fromScan = true;
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
      this.fromScan = false;
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
