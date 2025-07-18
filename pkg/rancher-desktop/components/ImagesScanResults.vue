<script>
import { BadgeState } from '@rancher/components';

import SortableTable from '@pkg/components/SortableTable';

const SEVERITY_MAP = {
  LOW: {
    color: 'bg-darker',
    id:    0,
  },
  MEDIUM: {
    color: 'bg-info',
    id:    1,
  },
  HIGH: {
    color: 'bg-warning',
    id:    2,
  },
  CRITICAL: {
    color: 'bg-error',
    id:    3,
  },
};

export default {
  components: {
    SortableTable,
    BadgeState,
  },

  props: {
    image: {
      type:     String,
      required: true,
    },
    tableData: {
      type:    Array,
      default: () => [],
    },
  },

  data() {
    return {
      headers: [
        {
          name:  'Severity',
          label: this.t('images.scan.results.headers.severity'),
          sort:  ['SeverityId:desc', 'PkgName', 'InstalledVersion'],
        },
        {
          name:  'PkgName',
          label: this.t('images.scan.results.headers.package'),
          sort:  ['PkgName', 'Severity', 'InstalledVersion'],
        },
        {
          name:  'VulnerabilityID',
          label: this.t('images.scan.results.headers.vulnerabilityId'),
          sort:  ['VulnerabilityID', 'Severity', 'PkgName', 'InstalledVersion'],
        },
        {
          name:  'InstalledVersion',
          label: this.t('images.scan.results.headers.installed'),
        },
        {
          name:  'FixedVersion',
          label: this.t('images.scan.results.headers.fixed'),
        },
      ],
    };
  },

  computed: {
    rows() {
      return this.tableData
        .map(({ Severity, ...rest }) => {
          return {
            SeverityId: this.id(Severity),
            Severity,
            ...rest,
          };
        });
    },
    criticalCount() {
      return this.issueCount(SEVERITY_MAP.CRITICAL.id);
    },
    criticalLabel() {
      return `${ this.t('images.scan.labels.critical') }: ${ this.criticalCount }`;
    },
    highCount() {
      return this.issueCount(SEVERITY_MAP.HIGH.id);
    },
    highLabel() {
      return `${ this.t('images.scan.labels.high') }: ${ this.highCount }`;
    },
    mediumCount() {
      return this.issueCount(SEVERITY_MAP.MEDIUM.id);
    },
    mediumLabel() {
      return `${ this.t('images.scan.labels.medium') }: ${ this.mediumCount }`;
    },
    lowCount() {
      return this.issueCount(SEVERITY_MAP.LOW.id);
    },
    lowLabel() {
      return `${ this.t('images.scan.labels.low') }: ${ this.lowCount }`;
    },
    issueSum() {
      return this.criticalCount + this.highCount + this.mediumCount + this.lowCount;
    },
    issueLabel() {
      return `${ this.t('images.scan.labels.issuesFound') }: ${ this.issueSum }`;
    },
  },

  methods: {
    color(severity) {
      return SEVERITY_MAP[severity]?.color;
    },
    id(severity) {
      return SEVERITY_MAP[severity]?.id;
    },
    issueCount(severity) {
      return this.rows.filter(row => row.SeverityId === severity).length;
    },
  },
};
</script>

<template>
  <sortable-table
    :headers="headers"
    :rows="rows"
    key-field="id"
    default-sort-by="Severity"
    :table-actions="false"
    :row-actions="false"
    :paging="true"
    :sub-rows="true"
    :sub-expandable="true"
    :sub-expand-column="true"
    :rows-per-page="25"
  >
    <template #header-left>
      <div class="issue-header">
        <badge-state
          v-if="issueSum"
          :label="issueLabel"
        />
        <badge-state
          v-if="criticalCount"
          color="bg-error"
          :label="criticalLabel"
        />
        <badge-state
          v-if="highCount"
          color="bg-warning"
          :label="highLabel"
        />
        <badge-state
          v-if="mediumCount"
          color="bg-info"
          :label="mediumLabel"
        />
        <badge-state
          v-if="lowCount"
          color="bg-darker"
          :label="lowLabel"
        />
      </div>
    </template>
    <template #col:VulnerabilityID="{ row }">
      <td>
        <span>
          <a :href="row.PrimaryURL">{{ row.VulnerabilityID }}</a>
        </span>
      </td>
    </template>
    <template #col:Severity="{ row }">
      <td>
        <badge-state
          :label="row.Severity"
          :color="color(row.Severity)"
        />
      </td>
    </template>
    <template #sub-row="{ row, fullColspan }">
      <td
        :colspan="fullColspan"
        class="sub-row"
      >
        <div class="details">
          <div class="col description">
            <section>
              <section class="title">
                {{ t('images.scan.details.description') }}
              </section>
              {{ row.Description }}
            </section>
          </div>
          <div class="col">
            <section>
              <section class="title">
                {{ t('images.scan.details.primaryUrl') }}
              </section>
              <a :href="row.PrimaryURL">{{ row.PrimaryURL }}</a>
            </section>
            <section>
              <section class="title">
                {{ t('images.scan.details.references') }}
              </section>
              <section
                v-for="(reference, idx) in row.References"
                :key="idx"
                class="reference"
              >
                <a :href="reference"> {{ reference }} </a>
              </section>
            </section>
          </div>
        </div>
      </td>
    </template>
  </sortable-table>
</template>

<style lang="scss" scoped>
  .sub-row {
    background-color: var(--body-bg);
    padding-left: 1rem;
    padding-right: 1rem;
  }

  .details {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: minmax(0, 1fr);
    gap: 1em;

    .col {
      display: flex;
      flex-direction: column;

      section {
        margin-bottom: 1.5rem;
      }

      .title, .reference {
        margin-bottom: 0.5rem;
      }

      .reference a {
        overflow-wrap: break-word;
      }

      .title {
        color: var(--muted);
      }
    }
  }

  .issue-header {
    display: flex;
    gap: 0.25rem;
  }
</style>
