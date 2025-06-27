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
import Vue from 'vue';

import CustomProgress from '@pkg/components/Progress.vue';
import { ipcRenderer } from '@pkg/utils/ipcRenderer';

export default Vue.extend({
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
