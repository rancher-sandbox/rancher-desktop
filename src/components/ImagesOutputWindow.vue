<script>
import { ipcRenderer } from 'electron';

export default {
  name: 'images-output-window',

  components: { Card },

  data() {
    return {
      keepImageManagerOutputWindowOpen: false,
      currentCommand:                   null,
      postCloseOutputWindowHandler:     null,
      imageManagerOutput:               '',
      imageOutputCuller:                null,
      completionStatus:                 false,
    };
  },

  computed: {
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
    ipcRenderer.on('images-process-output', (_event, data, isStderr) => {
      this.appendImageManagerOutput(data, isStderr);
    });
  },

  methods: {
    closeOutputWindow() {
      this.keepImageManagerOutputWindowOpen = false;
      if (this.postCloseOutputWindowHandler) {
        this.postCloseOutputWindowHandler();
        this.postCloseOutputWindowHandler = null;
      } else {
        this.imageManagerOutput = '';
      }
    },
    appendImageManagerOutput(data) {
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
  },
  }
};
</script>

<template>
  <card
    v-if="showImageManagerOutput"
    :show-highlight-border="false"
    :show-actions="false"
  >
    <template #title>
      <div class="type-title">
        <h3>{{ t('images.manager.title') }}</h3>
      </div>
    </template>
    <template #body>
      <div>
        <button
          v-if="imageManagerProcessIsFinished"
          class="role-tertiary"
          @click="closeOutputWindow"
        >
          {{ t('images.manager.close') }}
        </button>
        <textarea
          id="imageManagerOutput"
          v-model="imageManagerOutput"
          :class="{ success: imageManagerProcessFinishedWithSuccess, failure: imageManagerProcessFinishedWithFailure }"
          rows="10"
          readonly="true"
        />
      </div>
    </template>
  </card>
</template>
