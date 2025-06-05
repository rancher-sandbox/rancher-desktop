<!-- This is the Kubernetes backend progress notification in the bottom left
   - corner of the default layout.
   -->

<template>
  <div
    v-if="progressBusy"
    class="progress"
  >
    <label
      class="details"
      :title="progressDetails"
    >{{ progressDetails }}</label>
    <CustomProgress
      class="progress-bar"
      :indeterminate="progressIndeterminate"
      :value="progress.current"
      :maximum="progress.max"
    />
    <label
      class="duration"
      :title="progressDuration"
    >{{ progressDuration }}</label>
  </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue';

import CustomProgress from '@pkg/components/Progress.vue';
import { ipcRenderer } from '@pkg/utils/ipcRenderer';

export default defineComponent({
  name: 'backend-progress',
  components: { CustomProgress },
  data() {
    return {
      /** Current Kubernetes backend action progress. */
      progress: { current: 1, max: 1 } as {
        /** The current progress, from 0 to max. */
        readonly current: number;
        /** Maximum possible progress; if less than zero, the progress is indeterminate. */
        readonly max: number;
        /** Description of current action. */
        readonly description?: string;
        /** Time since the description became valid. */
        readonly transitionTime?: Date;
      },
      progressInterval: undefined as ReturnType<typeof setInterval> | undefined,
      progressDuration: '',
    };
  },

  computed: {
    progressDetails(): string {
      return this.progress.description || '';
    },
    progressIndeterminate(): boolean {
      return this.progress.max <= 0;
    },
    progressBusy(): boolean {
      return this.progressIndeterminate || this.progress.current < this.progress.max;
    },
  },

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

    ipcRenderer.invoke('k8s-progress').then((progress) => {
      this.progress = progress;
    });
  },

  methods: {
    /** Return a string describing the elapsed time or progress. */
    describeElapsed(since: number): string {
      if (this.progress.max > 0) {
        // If we have numbers, give a description about that.
        const units = ['', 'K', 'M', 'G', 'T'];
        const scales = [2**0, 2**10, 2**20, 2**30, 2**40];
        const remaining = this.progress.max - this.progress.current;

        const unitIndex = scales.findLastIndex((scale) => remaining * 2 >= scale);
        const fraction = remaining / scales[unitIndex];
        // If the fraction is 0.5...0.9999 display it as single significant figure.
        const display = fraction > 1 ? Math.round(fraction) : Math.round(fraction * 10) / 10;
        return `${ display }${ units[unitIndex] } left`;
      }
      if (!since) {
        return '';
      }
      // We have a starting time; describe how much time has elapsed since.
      // Start from the smallest unit, and modify `remaining` to be the next
      // unit up at every iteration.
      let remaining = Math.floor((Date.now() - since) / 1000); // Elapsed time, in seconds.
      const scales: [number, string][] = [[60, 's'], [60, 'm'], [24, 'h'], [Number.POSITIVE_INFINITY, 'd']];
      let label = '';

      for (const [scale, unit] of scales) {
        if (remaining % scale > 0) {
          // Add the part, but only if it's non-zero.
          label = `${ remaining % scale }${ unit }${ label }`;
        }
        remaining = Math.floor(remaining / scale);
      }

      return label;
    },
  },
});
</script>

<style lang="scss" scoped>
  .progress {
    display: flex;
    flex-direction: row;
    white-space: nowrap;
    align-items: center;
    flex: 1;

    .details {
      text-align: end;
      text-overflow: ellipsis;
      overflow: hidden;
      padding-right: 0.25rem;
      flex: 1;
    }

    .progress-bar {
      max-width: 12rem;
    }

    .duration {
      padding-left: 0.25rem;
    }
  }
</style>
