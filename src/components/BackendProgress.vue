<!-- This is the Kubernetes backend progress notification in the bottom left
   - corner of the default layout.
   -->

<template>
  <div v-if="progressBusy" class="progress">
    <!-- Wrap a label in a container, and make that flex horizontally to let
      it grow as needed without contributing to the width of the nav column. -->
    <div class="label-container">
      <label :title="progressDetails">{{ progressDetails }}</label>
    </div>
    <Progress
      :indeterminate="progressIndeterminate"
      :value="progress.current"
      :maximum="progress.max"
    />
  </div>
</template>

<script lang="ts">
import { ipcRenderer } from 'electron';
import Component from 'vue-class-component';
import Vue from 'vue';

import Progress from '@/components/Progress.vue';

@Component({ components: { Progress } })
class BackendProgress extends Vue {
  /** Current Kubernetes backend action progress. */
  progress: {
    /** The current progress, from 0 to max. */
    current: number;
    /** Maximum possible progress; if less than zero, the progress is indeterminate. */
    max: number;
    /** Description of current action. */
    description?: string;
    /** Time since the description became valid. */
    transitionTime?: Date;
  } = { current: 0, max: 0 };

  get progressDetails(): string {
    return this.progress.description || '';
  }

  get progressIndeterminate(): boolean {
    return this.progress.max <= 0;
  }

  get progressBusy(): boolean {
    return this.progressIndeterminate || this.progress.current < this.progress.max;
  }

  mounted() {
    ipcRenderer.on('k8s-progress', (event, progress) => {
      this.progress = progress;
    });
  }
}
export default BackendProgress;
</script>

<style lang="scss" scoped>
  .progress {
    background-color: var(--nav-bg);
    padding: 10px;

    .label-container {
      display: flex;

      label {
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
        flex: 1 0px;
        width: 0px;
      }
    }
  }
</style>
