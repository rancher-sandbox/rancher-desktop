<script lang="ts">
import { defineComponent } from 'vue';

import DiagnosticsGroup from '@pkg/components/DiagnosticsGroup.vue';
import RdButton from '@pkg/components/RdButton.vue';
import { DiagnosticsResult } from '@pkg/store/diagnostics';

export default defineComponent({
  name:       'diagnostics-body',
  components: { DiagnosticsGroup, RdButton },
  props:      {
    rows: {
      type:     Array as () => DiagnosticsResult[],
      required: true,
    },
    timeLastRun: {
      type:    Date,
      default: null,
    },
  },
  emits: ['run-diagnostics', 'mute', 'show'],

  computed: {
    summary(): string {
      const failed = this.rows.filter(d => !d.passed).length;
      const failedText = this.t('diagnostics.summary.failed', { count: failed }, true);

      if (failed > 0) {
        const muted = this.rows.filter(d => d.mute).length;

        if (muted > 0) {
          const mutedText = this.t('diagnostics.summary.muted', { count: muted }, true);

          return this.t('diagnostics.summary.plus', { failedText, mutedText });
        }
      }

      return failedText;
    },
    lastRunDisplay(): string {
      if (!this.timeLastRun) {
        return this.t('diagnostics.lastRun.never');
      }

      return this.t('diagnostics.lastRun.time', { time: this.timeLastRun.toLocaleString() });
    },
  },

  methods: {
    runDiagnostics() {
      this.$store.dispatch('diagnostics/runDiagnostics');
    },
    showMuted(show: boolean) {
      this.$store.dispatch('diagnostics/showMuted', show);
    },
  },
});
</script>

<template>
  <div class="diagnostics-body">
    <div class="actions">
      <rd-button
        class="role-primary"
        @click="runDiagnostics"
      >
        {{ t('diagnostics.button.run') }}
      </rd-button>
      <div class="summary">
        {{ summary }}
      </div>
      <div class="last-run">
        {{ lastRunDisplay }}
      </div>
    </div>
    <diagnostics-group
      :rows="rows"
      @mute="id => $store.dispatch('diagnostics/mute', id)"
      @show-muted="showMuted"
    />
  </div>
</template>

<style lang="scss" scoped>
  .diagnostics-body {
    display: grid;
    grid-template-rows: auto 1fr;
    gap: 1rem;
    height: 100%;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .summary {
    flex: 1;
  }
</style>
