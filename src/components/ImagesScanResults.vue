<script>
import SortableTable from '@/components/SortableTable';
import Card from '@/components/Card.vue';
import BadgeState from '@/components/BadgeState.vue';

const SEVERITY_BADGE_MAP = {
  LOW:      'bg-darker',
  MEDIUM:   'bg-info',
  HIGH:     'bg-warning',
  CRITICAL: 'bg-error'
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
          sort:      ['Severity', 'PkgName', 'InstalldeVersion'],
        },
        {
          name:  'VulnerabilityID',
          label: 'Vulnerability ID',
          sort:  ['VulnerabilityID', 'Severity', 'PkgName', 'InstalldeVersion'],
        },
        {
          name:  'PkgName',
          label: 'Package',
          sort:  ['PkgName', 'Severity', 'InstalledVersion'],
        },
        {
          name:  'InstalledVersion',
          label: 'Installed Version'
        },
        {
          name:  'FixedVersion',
          label: 'Fixed Version'
        }
      ],
    };
  },

  methods: {
    color(severity) {
      return SEVERITY_BADGE_MAP[severity];
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
        :rows="tableData"
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
            >
            </badge-state>
          </td>
        </template>
      </sortable-table>
    </template>
  </Card>
</template>
