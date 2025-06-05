<script lang="ts">
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { PropType, defineComponent } from 'vue';

dayjs.extend(relativeTime);

export default defineComponent({
  name:  'diagnostics-button-run',
  props: { timeLastRun: Date as PropType<Date> },
  data() {
    return {
      lastRunInterval: undefined as ReturnType<typeof setInterval> | undefined,
      currentTime:     dayjs(),
    };
  },
  computed: {
    friendlyTimeLastRun(): string {
      // Because the currentTime is updated only every second it's possible for the last-time-run to have
      // happened after the current-time.
      // We can't update this.currentTime because computed methods can't have side-effects, so treat an
      // older currentTime the same as timeLastRun.

      if (this.currentTime.valueOf() >= this.timeLastRun.valueOf()) {
        return this.currentTime.to(dayjs(this.timeLastRun));
      } else {
        return this.currentTime.to(this.currentTime);
      }
    },
    timeLastRunTooltip(): string {
      return this.timeLastRun.toLocaleString();
    },
  },
  mounted() {
    this.lastRunInterval = setInterval(() => {
      this.currentTime = dayjs();
    }, 1000);
  },
  beforeDestroy() {
    clearInterval(this.lastRunInterval);
  },
  methods: {
    async onClick() {
      const credentials = await this.$store.dispatch('credentials/fetchCredentials');

      await this.$store.dispatch('diagnostics/runDiagnostics', credentials);
    },
  },
});
</script>

<template>
  <div class="diagnostics-actions">
    <button
      class="btn btn-xs role-secondary"
      @click="onClick"
    >
      <span class="icon icon-refresh icon-diagnostics"></span>
      Rerun
    </button>
    <div class="diagnostics-status-history">
      Last run: <span
        class="elapsed-timespan"
        :title="timeLastRunTooltip"
      >{{ friendlyTimeLastRun }}</span>
    </div>
  </div>
</template>

<style lang="scss" scoped>
  .diagnostics-actions {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 0.5rem;
  }

  .btn-xs {
    min-height: 2.25rem;
    max-height: 2.25rem;
    line-height: 0.25rem;
  }

  .icon-diagnostics {
    padding-right: 0.25rem;
  }
</style>
