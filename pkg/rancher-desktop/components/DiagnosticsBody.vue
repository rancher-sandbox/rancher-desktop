<script lang="ts">
import { ToggleSwitch } from '@rancher/components';
import Vue, { VueConstructor } from 'vue';
import { mapGetters } from 'vuex';

import DiagnosticsButtonRun from '@pkg/components/DiagnosticsButtonRun.vue';
import EmptyState from '@pkg/components/EmptyState.vue';
import SortableTable from '@pkg/components/SortableTable/index.vue';
import type { DiagnosticsResult } from '@pkg/main/diagnostics/diagnostics';
import { DiagnosticsCategory } from '@pkg/main/diagnostics/types';

import type { PropType } from 'vue';

interface VuexBindings {
  showMuted: boolean;
}

export default (Vue as VueConstructor<Vue & VuexBindings>).extend({
  name:       'DiagnosticsBody',
  components: {
    DiagnosticsButtonRun,
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
      expanded: Object.fromEntries(Object.values(DiagnosticsCategory).map(c => [c, true])) as Record<DiagnosticsCategory, boolean>,
    };
  },
  computed: {
    ...mapGetters('preferences', ['showMuted']),
    numFailed(): number {
      return this.rows.length - this.numMuted;
    },
    numMuted(): number {
      return this.rows.filter(row => row.mute).length;
    },
    filteredRows(): DiagnosticsResult[] {
      if (this.showMuted) {
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
      return !!process.env.RD_ENV_DIAGNOSTICS_FIXES;
    },
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
      this.$store.dispatch('preferences/setShowMuted', !this.showMuted as boolean);
    },
    toggleExpand(group: DiagnosticsCategory) {
      this.expanded[group] = !this.expanded[group];
    },
  },
});
</script>

<template>
  <div
    class="diagnostics"
    data-test="diagnostics"
  >
    <div class="status">
      <div class="result-info">
        <div class="item-results">
          <span class="icon icon-dot text-error" />{{ numFailed }} failed plus {{ numMuted }} muted
        </div>
        <toggle-switch
          off-label="Show Muted"
          :value="showMuted"
          @input="toggleMute"
        />
      </div>
      <div class="spacer" />
      <diagnostics-button-run
        class="button-run"
        :time-last-run="timeLastRun"
      />
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
            <template
              v-if="areAllRowsMuted"
              #primary-action
            >
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
        <tr
          :ref="`group-${group.ref}`"
          class="group-row"
          :aria-expanded="expanded[group.ref]"
        >
          <td
            class="col-description"
            role="columnheader"
          >
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
          <td
            class="col-mute"
            role="columnheader"
          >
            <span>Mute</span>
          </td>
        </tr>
      </template>
      <template #col:description="{row}">
        <td>
          <span v-html="row.description"></span>
          <a
            v-if="row.documentation"
            :href="row.documentation"
            class="doclink"
          ><span class="icon icon-external-link" /></a>
        </td>
      </template>
      <template #col:mute="{row}">
        <td>
          <toggle-switch
            class="mute-toggle"
            :data-test="`diagnostics-mute-row-${row.id}`"
            :value="row.mute"
            @input="muteRow($event, row)"
          />
        </td>
      </template>
      <template
        v-if="featureFixes"
        #sub-row="{row}"
      >
        <tr>
          <!--We want an empty data cell so description will align with name-->
          <td></td>
          <td
            v-if="row.fixes.length > 0"
            class="sub-row"
          >
            {{ row.fixes.map(fix => fix.description).join('\n') }}
          </td>
          <td v-else>
            (No fixes available)
          </td>
          <!--Empty data cells for remaining columns for row highlight-->
          <td
            v-for="header in headers.length - 1"
            :key="header.name"
          />
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

      .spacer {
        flex-grow: 1;
      }

      .result-info {
        display: flex;
        flex-direction: column;
        gap: 1em;

        .item-results {
          display: flex;
          flex: 1;
          gap: 0.5rem;
          align-items: center;
        }
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

      &:not([aria-expanded]) {
        :deep(~ .main-row) {
          visibility: collapse;
          .toggle-container {
            /* When using visibility:collapse, the toggle switch produces some
            * artifacts; force it to display:none to avoid flickering. */
            display: none;
          }
        }
        .col-mute {
          display: none;
        }
      }
    }

    .mute-toggle :deep(.label) {
      /* We have no labels on the mute toggles; force them to not exist so that
         the two sides of the table have equal padding. */
      display: none;
    }

    .doclink {
      margin-left: 0.1rem;
      .icon {
        vertical-align: baseline;
      }
    }
  }
</style>
