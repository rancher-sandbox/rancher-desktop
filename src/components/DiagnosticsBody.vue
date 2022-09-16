<script lang="ts">
import { ToggleSwitch } from '@rancher/components';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import Vue from 'vue';

import EmptyState from '@/components/EmptyState.vue';
import SortableTable from '@/components/SortableTable/index.vue';
import type { DiagnosticsResult } from '@/main/diagnostics/diagnostics';
import { DiagnosticsCategory } from '@/main/diagnostics/types';

import type { PropType } from 'vue';

dayjs.extend(relativeTime);

let lastRunInterval: ReturnType<typeof setInterval>;

export default Vue.extend({
  name:       'DiagnosticsBody',
  components: {
    SortableTable,
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
          name:  'mute',
          label: 'Mute',
          width: 76,
        },
      ],
      hideMuted:   false,
      currentTime: dayjs(),
      expanded:    Object.fromEntries(Object.values(DiagnosticsCategory).map(c => [c, true])) as Record<DiagnosticsCategory, boolean>,
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
    filteredRows(): DiagnosticsResult[] {
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

    featureFixes(): boolean {
      return !!this.$config.featureDiagnosticsFixes;
    },
  },
  mounted() {
    lastRunInterval = setInterval(() => {
      this.currentTime = dayjs();
    }, 1000);
    for (const group of Object.values(DiagnosticsCategory)) {
      this.updateExpandVisibility(group);
    }
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
    updateExpandVisibility(group: DiagnosticsCategory) {
      const expanded = this.expanded[group];
      const groupRow = this.$refs[`group-${ group }`];

      if (groupRow instanceof HTMLElement) {
        groupRow.setAttribute('aria-expaneded', expanded ? 'true' : 'false');
        if (expanded) {
          groupRow.parentElement?.setAttribute('data-expanded', '');
        } else {
          groupRow.parentElement?.removeAttribute('data-expanded');
        }
      }
    },
    toggleExpand(group: DiagnosticsCategory) {
      this.expanded[group] = !this.expanded[group];

      this.updateExpandVisibility(group);
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
      group-by="category"
      :search="false"
      :table-actions="false"
      :row-actions="false"
      :show-headers="false"
      :sub-rows="featureFixes"
      :sub-expandable="featureFixes"
      :sub-expand-column="featureFixes"
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
      <template #group-row="{group}">
        <tr :ref="`group-${group.ref}`" class="group-row" aria-expanded="true">
          <td class="col-description" role="columnheader">
            <div class="group-tab">
              <i
                data-title="Toggle Expand"
                :class="{
                  icon: true,
                  'icon-chevron-right': !expanded[group.ref],
                  'icon-chevron-down': !!expanded[group.ref]
                }"
                @click.stop="toggleExpand(group.ref)"
              />
              {{ group.ref }}
            </div>
          </td>
          <td class="col-mute" role="columnheader">
            <span>Mute</span>
          </td>
        </tr>
      </template>
      <template #col:description="{row}">
        <td>
          <span>{{ row.description }}</span>
          <a :href="row.documentation" class="doclink"><span class="icon icon-external-link" /></a>
        </td>
      </template>
      <template #col:mute="{row}">
        <td>
          <toggle-switch
            class="mute-toggle"
            :value="row.mute"
            @input="muteRow($event, row)"
          />
        </td>
      </template>
      <template v-if="featureFixes" #sub-row="{row}">
        <tr>
          <!--We want an empty data cell so description will align with name-->
          <td></td>
          <td v-if="row.fixes.length > 0" class="sub-row">
            {{ row.fixes.map(fix => fix.description).join('\n') }}
          </td>
          <td v-else>
            (No fixes available)
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

    .group-row {
      .col-description {
        font-weight: bold;
        .group-tab {
          border-top-left-radius: 0;
        }
      }
      .col-mute {
        text-align: center;
        width: 0; /* minimal width, to right-align it. */
        /* Apply the same left/right padding so columns line up correctly. */
        padding-left: 5px;
        padding-right: 10px;
        & > span {
          /* Make the column label the same width as the toggle buttons */
          display: inline-block;
          width: 48px;
        }
      }
    }

    &::v-deep .group:not([data-expanded]) .main-row {
      visibility: collapse;
    }

    .mute-toggle::v-deep .label {
      /* We have no labels on the mute toggles; force them to not exist so that
         the two sides of the table have equal padding. */
      display: none;
    }

    .doclink {
      margin-left: 0.1rem;
      .icon {
        /* These two rules work around the icon itself being too high. */
        margin-bottom: 0.075rem;
        vertical-align: bottom;
      }
    }
  }
</style>
