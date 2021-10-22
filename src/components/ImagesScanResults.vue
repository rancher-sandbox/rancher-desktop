<script>
import SortableTable from '@/components/SortableTable';
import BadgeState from '@/components/BadgeState.vue';

const SEVERITY_MAP = {
  LOW:      {
    color: 'bg-darker',
    id:    0,
  },
  MEDIUM:   {
    color: 'bg-info',
    id:    1,
  },
  HIGH:     {
    color: 'bg-warning',
    id:    2,
  },
  CRITICAL: {
    color: 'bg-error',
    id:    3,
  }
};

export default {
  components: {
    SortableTable,
    BadgeState
  },

  props: {
    image: {
      type:     String,
      required: true,
    },
    tableData: {
      type:    Array,
      default: () => []
    }
  },

  data() {
    return {
      headers: [
        {
          name:      'Severity',
          label:     'Severity',
          sort:      ['SeverityId:desc', 'PkgName', 'InstalldeVersion'],
        },
        {
          name:  'PkgName',
          label: 'Package',
          sort:  ['PkgName', 'Severity', 'InstalledVersion'],
        },
        {
          name:  'VulnerabilityID',
          label: 'Vulnerability ID',
          sort:  ['VulnerabilityID', 'Severity', 'PkgName', 'InstalldeVersion'],
        },
        {
          name:  'InstalledVersion',
          label: 'Installed'
        },
        {
          name:  'FixedVersion',
          label: 'Fixed'
        }
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
            ...rest
          };
        });
    }
  },

  methods: {
    color(severity) {
      return SEVERITY_MAP[severity]?.color;
    },
    id(severity) {
      return SEVERITY_MAP[severity]?.id;
    }
  }
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
  >
    <template #col:VulnerabilityID="{row}">
      <td>
        <span>
          <a :href="row.PrimaryURL">{{ row.VulnerabilityID }}</a>
        </span>
      </td>
    </template>
    <template #col:Severity="{row}">
      <td>
        <badge-state
          :label="row.Severity"
          :color="color(row.Severity)"
        />
      </td>
    </template>
    <template #sub-row="{row, fullColspan}">
      <td :colspan="fullColspan" class="sub-row">
        <div class="details">
          <div class="col description">
            <section>
              <section class="title">
                Description
              </section>
              {{ row.Description }}
            </section>
          </div>
          <div class="col">
            <section>
              <section class="title">
                Primary URL
              </section>
              <a :href="row.PrimaryURL">{{ row.PrimaryURL }}</a>
            </section>
            <section>
              <section class="title">
                References
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
      <!-- <tr class="sub-row">
        <td :colspan="fullColspan">
          <Banner v-if="(row.state==='fail' || row.state==='warn')&& row.remediation" class="sub-banner" :label="remediationDisplay(row)" color="warning" />
          <SortableTable
            class="sub-table"
            :rows="row.nodeRows"
            :headers="nodeTableHeaders"
            :search="false"
            :row-actions="false"
            :table-actions="false"
            key-field="id"
          />
        </td>
      </tr> -->
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
</style>
