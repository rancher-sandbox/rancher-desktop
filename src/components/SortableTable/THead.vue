<script>
import { queryParamsFor } from '@/plugins/extend-router';
import { SORT_BY, DESCENDING } from '@/config/query-params';
import Checkbox from '@/components/form/Checkbox';
import { SOME, NONE } from './selection';

export default {
  components: { Checkbox },
  props:      {
    columns: {
      type:     Array,
      required: true
    },
    sortBy: {
      type:     String,
      required: true
    },
    defaultSortBy: {
      type:    String,
      default: ''
    },
    descending: {
      type:     Boolean,
      required: true
    },
    tableActions: {
      type:     Boolean,
      required: true,
    },
    rowActions: {
      type:     Boolean,
      required: true,
    },
    howMuchSelected: {
      type:     String,
      required: true,
    },
    checkWidth: {
      type:     Number,
      default:  30,
    },
    rowActionsWidth: {
      type:     Number,
      required: true
    },
    subExpandColumn: {
      type:    Boolean,
      default: false,
    },
    expandWidth: {
      type:    Number,
      default: 30,
    },
    labelFor: {
      type:     Function,
      required: true,
    },
  },

  computed: {
    isAll: {
      get() {
        return this.howMuchSelected !== NONE;
      },

      set(value) {
        this.$emit('on-toggle-all', value);
      }
    },

    isIndeterminate() {
      return this.howMuchSelected === SOME;
    }
  },

  methods: {
    changeSort(e, col) {
      if ( !col.sort ) {
        return;
      }

      let desc = false;

      if ( this.sortBy === col.name ) {
        desc = !this.descending;
      }

      this.$emit('on-sort-change', col.name, desc);
    },

    isCurrent(col) {
      return col.name === this.sortBy;
    },

    queryFor(col) {
      const query = queryParamsFor(this.$route.query, {
        [SORT_BY]:    col.name,
        [DESCENDING]: this.isCurrent(col) && !this.descending,
      }, {
        [SORT_BY]:    this.defaultSortBy,
        [DESCENDING]: false,
      });

      return query;
    },
  }
};
</script>

<template>
  <thead>
    <tr>
      <th v-if="tableActions" :width="checkWidth" align="middle">
        <Checkbox
          v-model="isAll"
          class="check"
          :indeterminate="isIndeterminate"
        />
      </th>
      <th v-if="subExpandColumn" :width="expandWidth"></th>
      <th
        v-for="col in columns"
        :key="col.name"
        :align="col.align || 'left'"
        :width="col.width"
        :class="{ sortable: col.sort }"
        @click.prevent="changeSort($event, col)"
      >
        <nuxt-link v-if="col.sort" :to="{query: queryFor(col)}">
          <span v-html="labelFor(col)" />
          <span class="icon-stack">
            <i class="icon icon-sort icon-stack-1x faded" />
            <i v-if="isCurrent(col) && !descending" class="icon icon-sort-down icon-stack-1x" />
            <i v-if="isCurrent(col) && descending" class="icon icon-sort-up icon-stack-1x" />
          </span>
        </nuxt-link>
        <span v-else>{{ labelFor(col) }}</span>
      </th>
      <th v-if="rowActions" :width="rowActionsWidth">
      </th>
    </tr>
  </thead>
</template>

<style lang="scss" scoped>
  .sortable > A {
    display: inline-block;
    white-space: nowrap;
  }

  thead {
    tr {
      background-color: var(--sortable-table-header-bg);
      color: var(--body-text);
      text-align: left;
    }
  }

  th {
    padding: 12px 5px;
    font-weight: normal;
    border: 0;
    color: var(--body-text);

    & A {
      color: var(--body-text);
    }
  }

  .icon-stack {
    width: 12px;
  }

  .icon-sort {
    &.faded {
      opacity: .3;
    }
  }
</style>
