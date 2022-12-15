<!-- This is the Kubernetes backend progress notification in the bottom left
   - corner of the default layout.
   -->

<template>
  <div v-if="progressBusy" class="progress">
    <!-- Wrap a label in a container, and make that flex horizontally to let
      it grow as needed without contributing to the width of the nav column. -->
    <div class="label-container">
      <label class="details" :title="progressDetails">{{ progressDetails }}</label>
      <label class="duration" :title="progressDuration">{{ progressDuration }}</label>
    </div>
    <Progress
      :indeterminate="progressIndeterminate"
      :value="progress.current"
      :maximum="progress.max"
    />
  </div>
</template>

<script lang="ts">
import Vue from 'vue';
import Component from 'vue-class-component';

import Progress from '@pkg/components/Progress.vue';
import { ipcRenderer } from '@pkg/utils/ipcRenderer';

@Component({ components: { Progress } })
class BackendProgress extends Vue {
  /** Current Kubernetes backend action progress. */
  progress: {
    /** The current progress, from 0 to max. */
    readonly current: number;
    /** Maximum possible progress; if less than zero, the progress is indeterminate. */
    readonly max: number;
    /** Description of current action. */
    readonly description?: string;
    /** Time since the description became valid. */
    readonly transitionTime?: Date;
  } = { current: 1, max: 1 };

  progressInterval: ReturnType<typeof setInterval> | undefined;

  get progressDetails(): string {
    return this.progress.description || '';
  }

  progressDuration = '';

  get progressIndeterminate(): boolean {
    return this.progress.max <= 0;
  }

  get progressBusy(): boolean {
    return this.progressIndeterminate || this.progress.current < this.progress.max;
  }

  /** Return a string describing the elapsed time or progress. */
  describeElapsed(since: number): string {
    if (this.progress.max > 0) {
      // If we have numbers, give a description about that.
      const units = ['', 'K', 'M', 'G', 'T'];
      let remaining = this.progress.max - this.progress.current;

      while (remaining > 512 && units.length > 0) {
        remaining /= 1024;
        units.shift();
      }
      if (remaining > 0) {
        remaining = Math.round(remaining);
      } else {
        remaining = Math.round(remaining * 10) / 10;
      }

      return `${ remaining }${ units[0] } left`;
    }
    if (!since) {
      return '';
    }
    let remaining = Math.floor((Date.now() - since) / 1000);
    const parts: [number, string][] = [];

    parts.unshift([remaining % 60, 's']);
    remaining = Math.floor(remaining / 60);
    parts.unshift([remaining % 60, 'm']);
    remaining = Math.floor(remaining / 60);
    parts.unshift([remaining % 24, 'h']);
    parts.unshift([Math.floor(remaining / 24), 'd']);

    return parts.filter(([n, s]) => n > 0).map(([n, s]) => `${ n }${ s }`).join('');
  }

  mounted() {
    ipcRenderer.on('k8s-progress', (event, progress) => {
      this.progress = progress;
      if (this.progress.transitionTime) {
        if (!this.progressInterval) {
          const start = this.progress.transitionTime.valueOf();

          this.progressInterval = setInterval(() => {
            this.progressDuration = this.describeElapsed(start);
          }, 500);
        }
      } else if (this.progressInterval) {
        clearInterval(this.progressInterval);
        this.progressInterval = undefined;
        this.progressDuration = '';
      }
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
      }

      .details {
        text-overflow: ellipsis;
        flex: 1 0px;
        width: 0px;
      }
    }
  }
</style>
