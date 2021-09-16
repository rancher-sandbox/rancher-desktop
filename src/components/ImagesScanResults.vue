<script>
import SortableTable from '@/components/SortableTable';
import Card from '@/components/Card.vue';
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
    Card,
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
      return SEVERITY_MAP[severity].color;
    },
    id(severity) {
      return SEVERITY_MAP[severity].id;
    }
  }
};
</script>

<template>
  <Card :show-highlight-border="false" :show-actions="false">
    <template #title>
      <div class="type-title">
        <h3>Image Scan Results - {{ image }}</h3>
      </div>
    </template>
    <template #body>
      <sortable-table
        :headers="headers"
        :rows="rows"
        key-field="id"
        default-sort-by="Severity"
        :table-actions="false"
        :row-actions="false"
        :paging="true"
      >
        <template #header-left>
          <button
            class="role-tertiary"
            @click="$emit('close:output')"
          >
            {{ t('images.manager.close') }}
          </button>
        </template>
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
      </sortable-table>
    </template>
  </Card>
</template>
