<script>
import { Checkbox } from '@rancher/components';

import { SOME, NONE } from './selection';

export default {
  components: { Checkbox },
  props:      {
    columns: {
      type:     Array,
      required: true,
    },
    sortBy: {
      type:     String,
      required: true,
    },
    defaultSortBy: {
      type:    String,
      default: '',
    },
    descending: {
      type:     Boolean,
      required: true,
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
      type:    Number,
      default: 30,
    },
    rowActionsWidth: {
      type:     Number,
      required: true,
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
    noRows: {
      type:    Boolean,
      default: true,
    },
    noResults: {
      type:    Boolean,
      default: true,
    },
    loading: {
      type:     Boolean,
      required: false,
    },
  },

  computed: {
    isAll: {
      get() {
        return this.howMuchSelected !== NONE;
      },

      set(value) {
        this.$emit('on-toggle-all', value);
      },
    },

    isIndeterminate() {
      return this.howMuchSelected === SOME;
    },
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
  },
};
</script>

<template>
  <thead>
    <tr :class="{'loading': loading}">
      <th v-if="tableActions" :width="checkWidth" align="middle">
        <Checkbox
          v-model="isAll"
          class="check"
          :indeterminate="isIndeterminate"
          :disabled="noRows || noResults"
        />
      </th>
      <th v-if="subExpandColumn" :width="expandWidth"></th>
      <th
        v-for="col in columns"
        :key="col.name"
        :align="col.align || 'left'"
        :width="col.width"
        :class="{ sortable: col.sort, [col.breakpoint]: !!col.breakpoint}"
        @click.prevent="changeSort($event, col)"
      >
        <span v-if="col.sort" v-tooltip="col.tooltip">
          <span v-html="labelFor(col)" />
          <span class="icon-stack">
            <i class="icon icon-sort icon-stack-1x faded" />
            <i v-if="isCurrent(col) && !descending" class="icon icon-sort-down icon-stack-1x" />
            <i v-if="isCurrent(col) && descending" class="icon icon-sort-up icon-stack-1x" />
          </span>
        </span>
        <span v-else v-tooltip="col.tooltip">{{ labelFor(col) }}</span>
      </th>
      <th v-if="rowActions" :width="rowActionsWidth">
      </th>
    </tr>
  </thead>
</template>

<style lang="scss" scoped>
  .sortable > SPAN {
    cursor: pointer;
    user-select: none;
    white-space: nowrap;
    &:hover,
    &:active {
      text-decoration: underline;
      color: var(--body-text);
    }
  }

  thead {
    tr {
      background-color: var(--sortable-table-header-bg);
      color: var(--body-text);
      text-align: left;

      &:not(.loading) {
        border-bottom: 1px solid var(--sortable-table-top-divider);
      }
    }
  }

  th {
    padding: 8px 5px;
    font-weight: normal;
    border: 0;
    color: var(--body-text);

    &:first-child {
      padding-left: 10px;
    }

    &:last-child {
      padding-right: 10px;
    }

    &:not(.sortable) > SPAN {
      display: block;
      margin-bottom: 2px;
    }

    & A {
      color: var(--body-text);
    }

    // Aligns with COLUMN_BREAKPOINTS
    @media only screen and (max-width: map-get($breakpoints, '--viewport-4')) {
      // HIDE column on sizes below 480px
      &.tablet, &.laptop, &.desktop {
        display: none;
      }
    }
    @media only screen and (max-width: map-get($breakpoints, '--viewport-9')) {
      // HIDE column on sizes below 992px
      &.laptop, &.desktop {
        display: none;
      }
    }
    @media only screen and (max-width: map-get($breakpoints, '--viewport-12')) {
      // HIDE column on sizes below 1281px
      &.desktop {
        display: none;
      }
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
