<script lang="ts">
import { BadgeState, ToggleSwitch } from '@rancher/components';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import Vue from 'vue';

import EmptyState from '@/components/EmptyState.vue';
import SortableTable from '@/components/SortableTable/index.vue';
import type { DiagnosticsResult } from '@/main/diagnostics/diagnostics';

import type { PropType } from 'vue';

dayjs.extend(relativeTime);

let lastRunInterval: ReturnType<typeof setInterval>;

export default Vue.extend({
  name:       'DiagnosticsBody',
  components: {
    SortableTable,
    BadgeState,
    ToggleSwitch,
    EmptyState,
  },
  props: {
    rows: {
      type:     Array as PropType<DiagnosticsResult[]>,
      required: true,
    },
    timeLastRun: Date as PropType<Date>,
  },
  data() {
    return {
      headers: [
        {
          name:  'description',
          label: 'Name',
        },
        {
          name:  'documentation',
          label: 'Documentation',
          width: 106,
        },
        {
          name:  'category',
          label: 'Category',
          width: 96,
        },
        {
          name:  'mute',
          label: 'Mute',
          width: 76,
        },
      ],
      hideMuted:   false,
      currentTime: dayjs(),
    };
  },
  computed: {
    numFailed(): number {
      return this.rows.length;
    },
    numMuted(): number {
      return this.rows.filter(row => row.mute).length;
    },
    friendlyTimeLastRun(): string {
      return this.currentTime.to(dayjs(this.timeLastRun));
    },
    timeLastRunTooltip(): string {
      return this.timeLastRun.toLocaleString();
    },
    filteredRows(): any {
      if (!this.hideMuted) {
        return this.rows;
      }

      return this.rows.filter(x => !x.mute);
    },
    areAllRowsMuted(): boolean {
      return !!this.rows.length && this.rows.every(x => x.mute);
    },
    emptyStateIcon(): string {
      return this.areAllRowsMuted ? this.t('diagnostics.results.muted.icon') : this.t('diagnostics.results.success.icon');
    },
    emptyStateHeading(): string {
      return this.areAllRowsMuted ? this.t('diagnostics.results.muted.heading') : this.t('diagnostics.results.success.heading');
    },
    emptyStateBody(): string {
      return this.areAllRowsMuted ? this.t('diagnostics.results.muted.body') : this.t('diagnostics.results.success.body');
    },
  },
  mounted() {
    lastRunInterval = setInterval(() => {
      this.currentTime = dayjs();
    }, 1000);
  },
  beforeDestroy() {
    clearInterval(lastRunInterval);
  },
  methods: {
    pluralize(count: number, unit: string): string {
      const units = count === 1 ? unit : `${ unit }s`;

      return `${ count } ${ units } ago`;
    },
    muteRow(isMuted: boolean, row: DiagnosticsResult) {
      this.$store.dispatch('diagnostics/updateDiagnostic', { isMuted, row });
    },
    toggleMute() {
      this.hideMuted = !this.hideMuted;
    },
  },
});
</script>

<template>
  <div class="diagnostics">
    <div class="status">
      <div class="item-results">
        <span class="icon icon-dot text-error" />{{ numFailed }} failed ({{ numMuted }} muted)
        <toggle-switch
          v-model="hideMuted"
          off-label="Hide Muted"
        />
      </div>
      <div class="diagnostics-status-history">
        Last run: <span class="elapsed-timespan" :title="timeLastRunTooltip">{{ friendlyTimeLastRun }}</span>
      </div>
    </div>
    <sortable-table
      key-field="id"
      :headers="headers"
      :rows="filteredRows"
      :search="false"
      :table-actions="false"
      :row-actions="false"
      :sub-rows="true"
      :sub-expandable="true"
      :sub-expand-column="true"
    >
      <template #no-rows>
        <td :colspan="headers.length + 1">
          <empty-state
            :icon="emptyStateIcon"
            :heading="emptyStateHeading"
            :body="emptyStateBody"
          >
            <template v-if="areAllRowsMuted" #primary-action>
              <button
                class="btn role-primary"
                @click="toggleMute"
              >
                Show Muted
              </button>
            </template>
          </empty-state>
        </td>
      </template>
      <template #col:description="{row}">
        <td>
          <span class="font-semibold">{{ row.description }}</span>
        </td>
      </template>
      <template #col:documentation="{row}">
        <td>
          <a :href="row.documentation"><span class="icon icon-external-link" /></a>
        </td>
      </template>
      <template #col:category="{row}">
        <td>
          <badge-state
            :label="row.category"
            color="bg-warning"
          />
        </td>
      </template>
      <template #col:mute="{row}">
        <td>
          <toggle-switch
            :value="row.mute"
            @input="muteRow($event, row)"
          />
        </td>
      </template>
      <template #sub-row="{row}">
        <tr>
          <!--We want an empty data cell so description will align with name-->
          <td></td>
          <td class="sub-row">
            {{ row.fixes.description }}
          </td>
          <!--Empty data cells for remaining columns for row highlight-->
          <td v-for="header in headers.length - 1" :key="header.name" />
        </tr>
      </template>
    </sortable-table>
  </div>
</template>

<style lang="scss" scoped>
  .diagnostics {
    display: flex;
    flex-direction: column;
    gap: 2rem;

    .status {
      display: flex;

      .item-results {
        display: flex;
        flex: 1;
        gap: 0.5rem;
        align-items: center;
      }
    }

    .font-semibold {
      font-weight: 600;
    }
  }
</style>
