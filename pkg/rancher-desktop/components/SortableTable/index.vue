<script>
import { mapGetters } from 'vuex';
import day from 'dayjs';
import isEmpty from 'lodash/isEmpty';
import { dasherize, ucFirst } from '@pkg/utils/string';
import { get, clone } from '@pkg/utils/object';
import { removeObject } from '@pkg/utils/array';
import { Checkbox } from '@rancher/components';
import AsyncButton, { ASYNC_BUTTON_STATES } from '@pkg/components/AsyncButton';
import ActionDropdown from '@pkg/components/ActionDropdown';
import throttle from 'lodash/throttle';
import debounce from 'lodash/debounce';
import THead from './THead';
import filtering from './filtering';
import selection from './selection';
import sorting from './sorting';
import paging from './paging';
import grouping from './grouping';
import actions from './actions';
import AdvancedFiltering from './advanced-filtering';
import LabeledSelect from '@pkg/components/form/LabeledSelect';
import { getParent } from '@pkg/utils/dom';
import { FORMATTERS } from '@pkg/components/SortableTable/sortable-config';

// Uncomment for table performance debugging
// import tableDebug from './debug';

// @TODO:
// Fixed header/scrolling

// Data Flow:
// rows prop
// --> sorting.js arrangedRows
// --> filtering.js handleFiltering()
// --> filtering.js filteredRows
// --> paging.js pageRows
// --> grouping.js groupedRows
// --> index.vue displayedRows

export default {
  name:       'SortableTable',
  components: {
    THead, Checkbox, AsyncButton, ActionDropdown, LabeledSelect
  },
  mixins: [
    filtering,
    sorting,
    paging,
    grouping,
    selection,
    actions,
    AdvancedFiltering,
    // For table performance debugging - uncomment and uncomment the corresponding import
    // tableDebug,
  ],

  props: {
    headers: {
      // {
      //    name:   Name for the column (goes in query param) and for defaultSortBy
      //    label:  Displayed column header
      //    sort:   string|array[string] Field name(s) to sort by, default: [name, keyField]
      //              fields can be suffixed with ':desc' to flip the normal sort order
      //    search: string|array[string] Field name(s) to search in, default: [name]
      //    width:  number
      // }
      type:     Array,
      required: true
    },
    rows: {
      // The array of objects to show
      type:     Array,
      required: true
    },
    keyField: {
      // Field that is unique for each row.
      type:    String,
      default: '_key',
    },

    loading: {
      type:     Boolean,
      required: false
    },

    /**
     * Alt Loading - True: Always show table rows and obscure them when `loading`. Intended for use with server-side pagination.
     *
     * Alt Loading - False: Hide the table rows when `loading`. Intended when all resources are provided up front.
     */
    altLoading: {
      type:     Boolean,
      required: false
    },

    groupBy: {
      // Field to group rows by, row[groupBy] must be something that can be a map key
      type:    String,
      default: null
    },
    groupRef: {
      // Object to provide as the reference for rendering the grouping row
      type:    String,
      default: null,
    },
    groupSort: {
      // Field to order groups by, defaults to groupBy
      type:    Array,
      default: null
    },

    defaultSortBy: {
      // Default field to sort by if none is specified
      // uses name on headers
      type:    String,
      default: null
    },

    tableActions: {
      // Show bulk table actions
      type:    Boolean,
      default: true
    },

    rowActions: {
      // Show action dropdown on the end of each row
      type:    Boolean,
      default: true
    },

    mangleActionResources: {
      type:    Function,
      default: null,
    },

    rowActionsWidth: {
      // How wide the action dropdown column should be
      type:    Number,
      default: 40
    },

    search: {
      // Show search input to filter rows
      type:    Boolean,
      default: true
    },

    extraSearchFields: {
      // Additional fields that aren't defined in the headers to search in on each row
      type:    Array,
      default: null
    },

    subRows: {
      // If there are sub-rows, your main row must have <tr class="main-row"> to identify it
      type:    Boolean,
      default: false,
    },

    subRowsDescription: {
      type:    Boolean,
      default: true,
    },

    subExpandable: {
      type:    Boolean,
      default: false,
    },

    subExpandColumn: {
      type:    Boolean,
      default: false,
    },

    subSearch: {
      // A field containing an array of sub-items to also search in for each row
      type:    String,
      default: null,
    },

    subFields: {
      // Search this list of fields within the items in "subSearch" of each row
      type:    Array,
      default: null,
    },

    /**
     * Show the divider between the thead and tbody.
     */
    topDivider: {
      type:    Boolean,
      default: true
    },

    /**
     * Show the dividers between rows
     */
    bodyDividers: {
      type:    Boolean,
      default: false
    },

    overflowX: {
      type:    Boolean,
      default: false
    },
    overflowY: {
      type:    Boolean,
      default: false
    },

    /**
     * If pagination of the data is enabled or not
     */
    paging: {
      type:    Boolean,
      default: false,
    },

    /**
     * What translation key to use for displaying the '1 - 10 of 100 Things' pagination info
     */
    pagingLabel: {
      type:    String,
      default: 'sortableTable.paging.generic'
    },

    /**
     * Additional params to pass to the pagingLabel translation
     */
    pagingParams: {
      type:    Object,
      default: null,
    },

    /**
     * Allows you to override the default preference of the number of
     * items to display per page. This is used by ./paging.js if you're
     * looking for a reference.
     */
    rowsPerPage: {
      type:    Number,
      default: null, // Default comes from the user preference
    },

    /**
     * Allows you to override the default translation text of no rows view
     */
    noRowsKey: {
      type:    String,
      default: 'sortableTable.noRows'
    },

    /**
     * Allows you to hide the no rows messaging.
     */
    showNoRows: {
      type:    Boolean,
      default: true
    },

    /**
     * Allows you to override the default translation text of no search data view
     */
    noDataKey: {
      type:    String,
      default: 'sortableTable.noData' // i18n-uses sortableTable.noData
    },

    /**
     * Allows you to override showing the THEAD section.
     */
    showHeaders: {
      type:    Boolean,
      default: true
    },

    sortGenerationFn: {
      type:    Function,
      default: null,
    },

    /**
     * The list will always be sorted by these regardless of what the user has selected
     */
    mandatorySort: {
      type:    Array,
      default: null,
    },

    /**
     * Allows you to link to a custom detail page for data that
     * doesn't have a class model. For example, a receiver configuration
     * block within an AlertmanagerConfig resource.
     */
    getCustomDetailLink: {
      type:    Function,
      default: null
    },

    /**
     * Inherited global identifier prefix for tests
     * Define a term based on the parent component to avoid conflicts on multiple components
     */
    componentTestid: {
      type:    String,
      default: 'sortable-table'
    },
    /**
     * Allows for the usage of a query param to work for simple filtering (q)
     */
    useQueryParamsForSimpleFiltering: {
      type:    Boolean,
      default: false
    },
    /**
     * Manaul force the update of live and delayed cells. Change this number to kick off the update
     */
    forceUpdateLiveAndDelayed: {
      type:    Number,
      default: 0
    },

    /**
     * True if pagination is executed outside of the component
     */
    externalPaginationEnabled: {
      type:    Boolean,
      default: false
    },

    /**
     * If `externalPaginationEnabled` is true this will be used as the current page
     */
    externalPaginationResult: {
      type:    Object,
      default: null
    }
  },

  data() {
    let searchQuery = '';
    let eventualSearchQuery = '';

    // only allow for filter query param for simple filtering for now...
    if (!this.hasAdvancedFiltering && this.useQueryParamsForSimpleFiltering && this.$route.query?.q) {
      searchQuery = this.$route.query?.q;
      eventualSearchQuery = this.$route.query?.q;
    }

    return {
      refreshButtonPhase:         ASYNC_BUTTON_STATES.WAITING,
      expanded:                   {},
      searchQuery,
      eventualSearchQuery,
      subMatches:                 null,
      actionOfInterest:           null,
      loadingDelay:               false,
      debouncedPaginationChanged: null,
      /**
       * The is the bool the DOM uses to show loading state. it's proxied from `loading` to avoid blipping the indicator (see usages)
       */
      isLoading:                  false,
    };
  },

  mounted() {
    this._loadingDelayTimer = setTimeout(() => {
      this.loadingDelay = true;
    }, 200);

    // Add scroll listener to the main element
    const $main = document.querySelector('main');

    this._onScroll = this.onScroll.bind(this);
    $main?.addEventListener('scroll', this._onScroll);

    this.debouncedPaginationChanged();
  },

  beforeUnmount() {
    clearTimeout(this._scrollTimer);
    clearTimeout(this._loadingDelayTimer);
    clearTimeout(this._altLoadingDelayTimer);
    clearTimeout(this._liveColumnsTimer);
    clearTimeout(this._delayedColumnsTimer);
    clearTimeout(this.manualRefreshTimer);

    const $main = document.querySelector('main');

    $main?.removeEventListener('scroll', this._onScroll);
  },

  watch: {
    eventualSearchQuery: debounce(function(q) {
      this.searchQuery = q;

      if (!this.hasAdvancedFiltering && this.useQueryParamsForSimpleFiltering) {
        const route = {
          name:   this.$route.name,
          params: { ...this.$route.params },
          query:  { ...this.$route.query, q }
        };

        if (!q && this.$route.query?.q) {
          route.query = {};
        }

        this.$router.replace(route);
      }
    }, 200),

    descending(neu, old) {
      this.watcherUpdateLiveAndDelayed(neu, old);
    },

    searchQuery(neu, old) {
      this.watcherUpdateLiveAndDelayed(neu, old);
    },

    sortFields(neu, old) {
      this.watcherUpdateLiveAndDelayed(neu, old);
    },

    groupBy(neu, old) {
      this.watcherUpdateLiveAndDelayed(neu, old);
    },

    namespaces(neu, old) {
      this.watcherUpdateLiveAndDelayed(neu, old);
    },

    page(neu, old) {
      this.watcherUpdateLiveAndDelayed(neu, old);
    },

    forceUpdateLiveAndDelayed(neu, old) {
      this.watcherUpdateLiveAndDelayed(neu, old);
    },

    // Ensure we update live and delayed columns on first load
    initalLoad: {
      handler(neu) {
        if (neu) {
          this._didinit = true;
          this.$nextTick(() => this.updateLiveAndDelayed());
        }
      },
      immediate: true
    },

    // this is the flag that indicates that manual refresh data has been loaded
    // and we should update the deferred cols
    manualRefreshLoadingFinished: {
      handler(neu, old) {
        // this is merely to update the manual refresh button status
        this.refreshButtonPhase = !neu ? ASYNC_BUTTON_STATES.WAITING : ASYNC_BUTTON_STATES.ACTION;
        if (neu && neu !== old) {
          this.$nextTick(() => this.updateLiveAndDelayed());
        }
      },
      immediate: true
    },

    loading: {
      handler(neu, old) {
        // Always ensure the Refresh button phase aligns with loading state (to ensure external phase changes which can then reset the internal phase changed by click)
        this.refreshButtonPhase = neu ? ASYNC_BUTTON_STATES.WAITING : ASYNC_BUTTON_STATES.ACTION;

        if (this.altLoading) {
          // Delay setting the actual loading indicator. This should avoid flashing up the indicator if the API responds quickly
          if (neu) {
            this._altLoadingDelayTimer = setTimeout(() => {
              this.isLoading = true;
            }, 200); // this should be higher than the targetted quick response
          } else {
            clearTimeout(this._altLoadingDelayTimer);
            this.isLoading = false;
          }
        } else {
          this.isLoading = neu;
        }
      },
      immediate: true
    },
  },

  created() {
    this.debouncedRefreshTableData = debounce(this.refreshTableData, 500);
    this.debouncedPaginationChanged = debounce(this.paginationChanged, 50);
  },

  computed: {
    ...mapGetters({ isTooManyItemsToAutoUpdate: 'resource-fetch/isTooManyItemsToAutoUpdate' }),
    ...mapGetters({ isManualRefreshLoading: 'resource-fetch/manualRefreshIsLoading' }),
    namespaces() {
      return this.$store.getters['activeNamespaceCache'];
    },

    initalLoad() {
      return !!(!this.isLoading && !this._didinit && this.rows?.length);
    },

    manualRefreshLoadingFinished() {
      const res = !!(!this.isLoading && this._didinit && this.rows?.length && !this.isManualRefreshLoading);

      // Always ensure the Refresh button phase aligns with loading state (regardless of if manualRefreshLoadingFinished has changed or not)
      this.refreshButtonPhase = !res || this.loading ? ASYNC_BUTTON_STATES.WAITING : ASYNC_BUTTON_STATES.ACTION;

      return res;
    },

    fullColspan() {
      let span = 0;

      for ( let i = 0 ; i < this.columns.length ; i++ ) {
        if (!this.columns[i].hide) {
          span++;
        }
      }

      if ( this.tableActions ) {
        span++;
      }

      if ( this.subExpandColumn ) {
        span++;
      }

      if ( this.rowActions ) {
        span++;
      }

      return span;
    },

    noResults() {
      return !!this.searchQuery && this.pagedRows.length === 0;
    },

    noRows() {
      return !this.noResults && (this.rows || []).length === 0;
    },

    showHeaderRow() {
      return this.search ||
        this.tableActions ||
        this.$slots['header-left']?.() ||
        this.$slots['header-middle']?.() ||
        this.$slots['header-right']?.();
    },

    columns() {
      // Filter out any columns that are too heavy to show for large page sizes
      const out = this.headers.slice().filter((c) => !c.maxPageSize || (c.maxPageSize && c.maxPageSize >= this.perPage));

      if ( this.groupBy ) {
        const entry = out.find((x) => x.name === this.groupBy);

        if ( entry ) {
          removeObject(out, entry);
        }
      }

      // If all columns have a width, try to remove it from a column that can be variable (name)
      const missingWidth = out.find((x) => !x.width);

      if ( !missingWidth ) {
        const variable = out.find((x) => x.canBeVariable);

        if ( variable ) {
          const neu = clone(variable);

          delete neu.width;

          out.splice(out.indexOf(variable), 1, neu);
        }
      }

      // handle cols visibility and filtering if there is advanced filtering
      if (this.hasAdvancedFiltering) {
        const cols = this.handleColsVisibilyAndFiltering(out);

        return cols;
      }

      return out;
    },

    // For data-title properties on <td>s
    dt() {
      const out = {
        check:   `Select: `,
        actions: `Actions: `,
      };

      this.columns.forEach((col) => {
        out[col.name] = `${ (col.label || col.name) }:`;
      });

      return out;
    },

    classObject() {
      return {
        'top-divider':   this.topDivider,
        'body-dividers': this.bodyDividers,
        'overflow-y':    this.overflowY,
        'overflow-x':    this.overflowX,
        'alt-loading':   this.altLoading && this.isLoading
      };
    },

    // Do we have any live columns?
    hasLiveColumns() {
      const liveColumns = this.columns.find((c) => c.formatter?.startsWith('Live') || c.liveUpdates);

      return !!liveColumns;
    },

    hasDelayedColumns() {
      const delaeydColumns = this.columns.find((c) => c.delayLoading);

      return !!delaeydColumns;
    },

    columnFormmatterIDs() {
      const columnsIds = {};

      this.columns.forEach((c) => {
        if (c.formatter) {
          columnsIds[c.formatter] = dasherize(c.formatter);
        }
      });

      return columnsIds;
    },

    // Generate row and column data for easier rendering in the template
    // ensures we only call methods like `valueFor` once
    displayRows() {
      const rows = [];
      const columnFormmatterIDs = this.columnFormmatterIDs;

      this.groupedRows.forEach((grp) => {
        const group = {
          grp,
          key:  grp.key,
          ref:  grp.ref,
          rows: [],
        };

        rows.push(group);

        grp.rows.forEach((row) => {
          const rowData = {
            row,
            key:                        this.get(row, this.keyField),
            showSubRow:                 this.showSubRow(row, this.keyField),
            canRunBulkActionOfInterest: this.canRunBulkActionOfInterest(row),
            columns:                    []
          };

          group.rows.push(rowData);

          this.columns.forEach((c) => {
            const value = c.delayLoading ? undefined : this.valueFor(row, c, c.isLabel);
            let component;
            let formatted = value;
            let needRef = false;

            if (Array.isArray(value)) {
              formatted = value.join(', ');
            }

            if (c.formatter) {
              if (FORMATTERS[c.formatter]) {
                component = FORMATTERS[c.formatter];
                needRef = true;
              } else {
                // Check if we have a formatter from a plugin
                const pluginFormatter = this.$plugin?.getDynamic('formatters', c.formatter);

                if (pluginFormatter) {
                  component = pluginFormatter;
                  needRef = true;
                }
              }
            }

            rowData.columns.push({
              col:       c,
              value,
              formatted,
              component,
              needRef,
              delayed:   c.delayLoading,
              live:      c.formatter?.startsWith('Live') || c.liveUpdates,
              label:     this.labelFor(c),
              dasherize: columnFormmatterIDs[c.formatter] || '',
            });
          });
        });
      });

      return rows;
    }
  },

  methods: {
    refreshTableData() {
      this.$store.dispatch('resource-fetch/doManualRefresh');
    },
    get,
    dasherize,

    onScroll() {
      if (this.hasLiveColumns || this.hasDelayedColumns) {
        clearTimeout(this._liveColumnsTimer);
        clearTimeout(this._scrollTimer);
        clearTimeout(this._delayedColumnsTimer);
        this._scrollTimer = setTimeout(() => {
          this.updateLiveColumns();
          this.updateDelayedColumns();
        }, 300);
      }
    },

    watcherUpdateLiveAndDelayed(neu, old) {
      if (neu !== old) {
        this.$nextTick(() => this.updateLiveAndDelayed());
      }
    },

    updateLiveAndDelayed() {
      if (this.hasLiveColumns) {
        this.updateLiveColumns();
      }

      if (this.hasDelayedColumns) {
        this.updateDelayedColumns();
      }
    },

    updateDelayedColumns() {
      clearTimeout(this._delayedColumnsTimer);

      if (!this.$refs.column || this.pagedRows.length === 0) {
        return;
      }

      const delayedColumns = this.$refs.column.filter((c) => c.startDelayedLoading && !c.__delayedLoading);
      // We add 100 pixels here - so we will render the delayed columns for a few extra rows below what is visible
      // This way if you scroll slowly, you won't see the columns being loaded
      const clientHeight = (window.innerHeight || document.documentElement.clientHeight) + 100;

      let scheduled = 0;

      for (let i = 0; i < delayedColumns.length; i++) {
        const dc = delayedColumns[i];
        const y = dc.$el.getBoundingClientRect().y;

        if (y >= 0 && y <= clientHeight) {
          dc.startDelayedLoading(true);
          dc.__delayedLoading = true;

          scheduled++;

          // Only update 4 at a time
          if (scheduled === 4) {
            this._delayedColumnsTimer = setTimeout(this.updateDelayedColumns, 100);

            return;
          }
        }
      }
    },

    updateLiveColumns() {
      clearTimeout(this._liveColumnsTimer);

      if (!this.$refs.column || !this.hasLiveColumns || this.pagedRows.length === 0) {
        return;
      }

      const clientHeight = window.innerHeight || document.documentElement.clientHeight;
      const liveColumns = this.$refs.column.filter((c) => !!c.liveUpdate);
      const now = day();
      let next = Number.MAX_SAFE_INTEGER;

      for (let i = 0; i < liveColumns.length; i++) {
        const column = liveColumns[i];
        const y = column.$el.getBoundingClientRect().y;

        if (y >= 0 && y <= clientHeight) {
          const diff = column.liveUpdate(now);

          if (diff < next) {
            next = diff;
          }
        }
      }

      if (next < 1 ) {
        next = 1;
      }

      // Schedule again
      this._liveColumnsTimer = setTimeout(() => this.updateLiveColumns(), next * 1000);
    },

    labelFor(col) {
      if ( col.labelKey ) {
        return this.t(col.labelKey, undefined, true);
      } else if ( col.label ) {
        return col.label;
      }

      return ucFirst(col.name);
    },

    valueFor(row, col, isLabel) {
      if (typeof col.value === 'function') {
        return col.value(row);
      }

      if (isLabel) {
        if (row.metadata?.labels && row.metadata?.labels[col.label]) {
          return row.metadata?.labels[col.label];
        }

        return '';
      }

      // Use to debug table columns using expensive value getters
      // console.warn(`Performance: Table valueFor: ${ col.name } ${ col.value }`); // eslint-disable-line no-console

      const expr = col.value || col.name;

      if (!expr) {
        console.error('No path has been defined for this column, unable to get value of cell', col); // eslint-disable-line no-console

        return '';
      }
      const out = get(row, expr);

      if ( out === null || out === undefined ) {
        return '';
      }

      return out;
    },

    isExpanded(row) {
      const key = row[this.keyField];

      return !!this.expanded[key];
    },

    toggleExpand(row) {
      const key = row[this.keyField];
      const val = !this.expanded[key];

      this.expanded[key] = val;
      this.expanded = { ...this.expanded };

      return val;
    },

    setBulkActionOfInterest(action) {
      this.actionOfInterest = action;
    },

    // Can the action of interest be applied to the specified resource?
    canRunBulkActionOfInterest(resource) {
      if ( !this.actionOfInterest || isEmpty(resource?.availableActions) ) {
        return false;
      }

      const matchingResourceAction = resource.availableActions?.find((a) => a.action === this.actionOfInterest.action);

      return matchingResourceAction?.enabled;
    },

    focusSearch() {
      if ( this.$refs.searchQuery ) {
        this.$refs.searchQuery.focus();
        this.$refs.searchQuery.select();
      }
    },

    nearestCheckbox() {
      return document.activeElement.closest('tr.main-row')?.querySelector('.checkbox-custom');
    },

    focusAdjacent(next = true) {
      const all = Array.from(this.$el.querySelectorAll('.checkbox-custom'));

      const cur = this.nearestCheckbox();
      let idx = -1;

      if ( cur ) {
        idx = all.indexOf(cur) + (next ? 1 : -1 );
      } else if ( next ) {
        idx = 1;
      } else {
        idx = all.length - 1;
      }

      if ( idx < 1 ) { // Don't go up to the check all button
        idx = 1;

        return null;
      }

      if ( idx >= all.length ) {
        idx = all.length - 1;

        return null;
      }

      if ( all[idx] ) {
        all[idx].focus();

        return all[idx];
      }
    },

    focusNext: throttle(function(event, more = false) {
      const elem = this.focusAdjacent(true);
      const row = getParent(elem, 'tr');

      if (row?.classList.contains('row-selected')) {
        return;
      }

      this.keySelectRow(row, more);
    }, 50),

    focusPrevious: throttle(function(event, more = false) {
      const elem = this.focusAdjacent(false);
      const row = getParent(elem, 'tr');

      if (row?.classList.contains('row-selected')) {
        return;
      }

      this.keySelectRow(row, more);
    }, 50),

    showSubRow(row, keyField) {
      const hasInjectedSubRows = this.subRows && (!this.subExpandable || this.expanded[get(row, keyField)]);
      const hasStateDescription = this.subRowsDescription && row.stateDescription;

      return hasInjectedSubRows || hasStateDescription;
    },

    handleActionButtonClick(i, event) {
      // Each row in the table gets its own ref with
      // a number based on its index. If you are using
      // an ActionMenu that doen't have a dependency on Vuex,
      // these refs are useful because you can reuse the
      // same ActionMenu component on a page with many different
      // target elements in a list,
      // so you can still avoid the performance problems that
      // could result if the ActionMenu was in every row. The menu
      // will open on whichever target element is clicked.
      this.$emit('clickedActionButton', {
        event,
        targetElement: this.$refs[`actionButton${ i }`][0],
      });
    },

    paginationChanged() {
      if (!this.externalPaginationEnabled) {
        return;
      }

      this.$emit('pagination-changed', {
        page:    this.page,
        perPage: this.perPage,
        filter:  {
          searchFields: this.searchFields,
          searchQuery:  this.searchQuery
        },
        sort:       this.sortFields,
        descending: this.descending
      });
    }
  }
};
</script>

<template>
  <div
    ref="container"
    :data-testid="componentTestid + '-list-container'"
  >
    <div
      :class="{'titled': $slots.title && $slots.title.length}"
      class="sortable-table-header"
    >
      <slot name="title" />
      <div
        v-if="showHeaderRow"
        class="fixed-header-actions"
        :class="{button: !!$slots['header-button'], 'advanced-filtering': hasAdvancedFiltering}"
      >
        <div
          :class="bulkActionsClass"
          class="bulk"
        >
          <slot name="header-left">
            <template v-if="tableActions">
              <button
                v-for="(act) in availableActions"
                :id="act.action"
                :key="act.action"
                v-clean-tooltip="actionTooltip"
                type="button"
                class="btn role-primary"
                :class="{[bulkActionClass]:true}"
                :disabled="!act.enabled"
                :data-testid="componentTestid + '-' + act.action"
                @click="applyTableAction(act, null, $event)"
                @mouseover="setBulkActionOfInterest(act)"
                @mouseleave="setBulkActionOfInterest(null)"
              >
                <i
                  v-if="act.icon"
                  :class="act.icon"
                />
                <span v-clean-html="act.label" />
              </button>
              <ActionDropdown
                :class="bulkActionsDropdownClass"
                class="bulk-actions-dropdown"
                :disable-button="!selectedRows.length"
                size="sm"
              >
                <template #button-content>
                  <button
                    ref="actionDropDown"
                    class="btn bg-primary mr-0"
                    :disabled="!selectedRows.length"
                  >
                    <i class="icon icon-gear" />
                    <span>{{ t('sortableTable.bulkActions.collapsed.label') }}</span>
                    <i class="ml-10 icon icon-chevron-down" />
                  </button>
                </template>
                <template #popover-content>
                  <ul class="list-unstyled menu">
                    <li
                      v-for="(act, i) in hiddenActions"
                      :key="i"
                      v-close-popper
                      v-clean-tooltip="{
                        content: actionTooltip,
                        placement: 'right'
                      }"
                      :class="{ disabled: !act.enabled }"
                      @click="applyTableAction(act, null, $event)"
                      @mouseover="setBulkActionOfInterest(act)"
                      @mouseleave="setBulkActionOfInterest(null)"
                    >
                      <i
                        v-if="act.icon"
                        :class="act.icon"
                      />
                      <span v-clean-html="act.label" />
                    </li>
                  </ul>
                </template>
              </ActionDropdown>
              <label
                v-if="selectedRowsText"
                :class="bulkActionAvailabilityClass"
                class="action-availability"
              >
                {{ selectedRowsText }}
              </label>
            </template>
          </slot>
        </div>
        <div
          v-if="!hasAdvancedFiltering && $slots['header-middle']"
          class="middle"
        >
          <slot name="header-middle" />
        </div>

        <div
          v-if="search || hasAdvancedFiltering || isTooManyItemsToAutoUpdate || $slots['header-right']"
          class="search row"
          data-testid="search-box-filter-row"
        >
          <ul
            v-if="hasAdvancedFiltering"
            class="advanced-filters-applied"
          >
            <li
              v-for="(filter, i) in advancedFilteringValues"
              :key="i"
            >
              <span class="label">{{ `"${filter.value}" ${ t('sortableTable.in') } ${filter.label}` }}</span>
              <span
                class="cross"
                @click="clearAdvancedFilter(i)"
              >&#10005;</span>
              <div class="bg" />
            </li>
          </ul>
          <slot name="header-right" />
          <AsyncButton
            v-if="isTooManyItemsToAutoUpdate"
            class="manual-refresh"
            mode="manual-refresh"
            :current-phase="refreshButtonPhase"
            @click="debouncedRefreshTableData"
          />
          <div
            v-if="hasAdvancedFiltering"
            ref="advanced-filter-group"
            class="advanced-filter-group"
          >
            <button
              class="btn role-primary"
              @click="advancedFilteringVisibility = !advancedFilteringVisibility;"
            >
              {{ t('sortableTable.addFilter') }}
            </button>
            <div
              v-show="advancedFilteringVisibility"
              class="advanced-filter-container"
            >
              <input
                ref="advancedSearchQuery"
                :value="advFilterSearchTerm"
                type="search"
                class="advanced-search-box"
                :placeholder="t('sortableTable.filterFor')"
                @input="($plainInputEvent) => advFilterSearchTerm = $plainInputEvent.target.value"
              >
              <div class="middle-block">
                <span>{{ t('sortableTable.in') }}</span>
                <LabeledSelect
                  v-model:value="advFilterSelectedProp"
                  class="filter-select"
                  :clearable="true"
                  :options="advFilterSelectOptions"
                  :disabled="false"
                  :searchable="false"
                  mode="edit"
                  :multiple="false"
                  :taggable="false"
                  :placeholder="t('sortableTable.selectCol')"
                  @selecting="(col) => advFilterSelectedLabel = col.label"
                />
              </div>
              <div class="bottom-block">
                <button
                  class="btn role-secondary"
                  :disabled="!advancedFilteringValues.length"
                  @click="clearAllAdvancedFilters"
                >
                  {{ t('sortableTable.resetFilters') }}
                </button>
                <button
                  class="btn role-primary"
                  @click="addAdvancedFilter"
                >
                  {{ t('sortableTable.add') }}
                </button>
              </div>
            </div>
          </div>
          <input
            v-else-if="search"
            ref="searchQuery"
            :value="eventualSearchQuery"
            type="search"
            class="input-sm search-box"
            :placeholder="t('sortableTable.search')"
            @input="($plainInputEvent) => eventualSearchQuery = $plainInputEvent.target.value"
          >
          <slot name="header-button" />
        </div>
      </div>
    </div>
    <table
      class="sortable-table"
      :class="classObject"
      width="100%"
    >
      <THead
        v-if="showHeaders"
        :label-for="labelFor"
        :columns="columns"
        :group="group"
        :group-options="advGroupOptions"
        :has-advanced-filtering="hasAdvancedFiltering"
        :adv-filter-hide-labels-as-cols="advFilterHideLabelsAsCols"
        :table-actions="tableActions"
        :table-cols-options="columnOptions"
        :row-actions="rowActions"
        :sub-expand-column="subExpandColumn"
        :row-actions-width="rowActionsWidth"
        :how-much-selected="howMuchSelected"
        :sort-by="sortBy"
        :default-sort-by="_defaultSortBy"
        :descending="descending"
        :no-rows="noRows"
        :loading="isLoading && !loadingDelay"
        :no-results="noResults"
        @on-toggle-all="onToggleAll"
        @on-sort-change="changeSort"
        @col-visibility-change="changeColVisibility"
        @group-value-change="(val) => $emit('group-value-change', val)"
        @update-cols-options="updateColsOptions"
      />

      <!-- Don't display anything if we're loading and the delay has yet to pass -->
      <div v-if="isLoading && !loadingDelay" />

      <tbody v-else-if="isLoading && !altLoading">
        <slot name="loading">
          <tr>
            <td :colspan="fullColspan">
              <div class="data-loading">
                <i class="icon-spin icon icon-spinner" />
                <t
                  k="generic.loading"
                  :raw="true"
                />
              </div>
            </td>
          </tr>
        </slot>
      </tbody>
      <tbody v-else-if="noRows">
        <slot name="no-rows">
          <tr class="no-rows">
            <td :colspan="fullColspan">
              <t
                v-if="showNoRows"
                :k="noRowsKey"
              />
            </td>
          </tr>
        </slot>
      </tbody>
      <tbody v-else-if="noResults">
        <slot name="no-results">
          <tr class="no-results">
            <td
              :colspan="fullColspan"
              class="text-center"
            >
              <t :k="noDataKey" />
            </td>
          </tr>
        </slot>
      </tbody>
      <tbody
        v-for="(groupedRows) in displayRows"
        v-else
        :key="groupedRows.key"
        :class="{ group: groupBy }"
      >
        <slot
          v-if="groupBy"
          name="group-row"
          :group="groupedRows"
          :fullColspan="fullColspan"
        >
          <tr class="group-row">
            <td :colspan="fullColspan">
              <slot
                name="group-by"
                :group="groupedRows.grp"
              >
                <div
                  v-trim-whitespace
                  class="group-tab"
                >
                  {{ groupedRows.ref }}
                </div>
              </slot>
            </td>
          </tr>
        </slot>
        <template
          v-for="(row, i) in groupedRows.rows"
          :key="i"
        >
          <slot
            name="main-row"
            :row="row.row"
          >
            <slot
              :name="'main-row:' + (row.row.mainRowKey || i)"
              :full-colspan="fullColspan"
            >
              <!-- The data-cant-run-bulk-action-of-interest attribute is being used instead of :class because
                because our selection.js invokes toggleClass and :class clobbers what was added by toggleClass if
                the value of :class changes. -->
              <tr
                class="main-row"
                :data-testid="componentTestid + '-' + i + '-row'"
                :class="{ 'has-sub-row': row.showSubRow}"
                :data-node-id="row.key"
                :data-cant-run-bulk-action-of-interest="actionOfInterest && !row.canRunBulkActionOfInterest"
              >
                <td
                  v-if="tableActions"
                  class="row-check"
                  align="middle"
                >
                  {{ row.mainRowKey }}<Checkbox
                    class="selection-checkbox"
                    :data-node-id="row.key"
                    :data-testid="componentTestid + '-' + i + '-checkbox'"
                    :value="selectedRows.includes(row.row)"
                  />
                </td>
                <td
                  v-if="subExpandColumn"
                  class="row-expand"
                  align="middle"
                >
                  <i
                    data-title="Toggle Expand"
                    :class="{
                      icon: true,
                      'icon-chevron-right': !expanded[row.row[keyField]],
                      'icon-chevron-down': !!expanded[row.row[keyField]]
                    }"
                    @click.stop="toggleExpand(row.row)"
                  />
                </td>
                <template
                  v-for="(col, j) in row.columns"
                  :key="j"
                >
                  <slot
                    :name="'col:' + col.col.name"
                    :row="row.row"
                    :col="col.col"
                    :dt="dt"
                    :expanded="expanded"
                    :rowKey="row.key"
                  >
                    <td
                      v-show="!hasAdvancedFiltering || (hasAdvancedFiltering && col.col.isColVisible)"
                      :key="col.col.name"
                      :data-title="col.col.label"
                      :data-testid="`sortable-cell-${ i }-${ j }`"
                      :align="col.col.align || 'left'"
                      :class="{['col-'+col.dasherize]: !!col.col.formatter, [col.col.breakpoint]: !!col.col.breakpoint, ['skip-select']: col.col.skipSelect}"
                      :width="col.col.width"
                    >
                      <slot
                        :name="'cell:' + col.col.name"
                        :row="row.row"
                        :col="col.col"
                        :value="col.value"
                      >
                        <component
                          :is="col.component"
                          v-if="col.component && col.needRef"
                          ref="column"
                          :value="col.value"
                          :row="row.row"
                          :col="col.col"
                          v-bind="col.col.formatterOpts"
                          :row-key="row.key"
                          :get-custom-detail-link="getCustomDetailLink"
                        />
                        <component
                          :is="col.component"
                          v-else-if="col.component"
                          :value="col.value"
                          :row="row.row"
                          :col="col.col"
                          v-bind="col.col.formatterOpts"
                          :row-key="row.key"
                        />
                        <component
                          :is="col.col.formatter"
                          v-else-if="col.col.formatter"
                          :value="col.value"
                          :row="row.row"
                          :col="col.col"
                          v-bind="col.col.formatterOpts"
                          :row-key="row.key"
                        />
                        <template v-else-if="col.value !== ''">
                          {{ col.formatted }}
                        </template>
                        <template v-else-if="col.col.dashIfEmpty">
                          <span class="text-muted">&mdash;</span>
                        </template>
                      </slot>
                    </td>
                  </slot>
                </template>
                <td
                  v-if="rowActions"
                  align="middle"
                >
                  <slot
                    name="row-actions"
                    :row="row.row"
                  >
                    <button
                      :id="`actionButton+${i}+${(row.row && row.row.name) ? row.row.name : ''}`"
                      :ref="`actionButton${i}`"
                      :data-testid="componentTestid + '-' + i + '-action-button'"
                      aria-haspopup="true"
                      aria-expanded="false"
                      type="button"
                      class="btn btn-sm role-multi-action actions"
                      @click="handleActionButtonClick(i, $event)"
                    >
                      <i class="icon icon-actions" />
                    </button>
                  </slot>
                </td>
              </tr>
            </slot>
          </slot>
          <slot
            v-if="row.showSubRow"
            name="sub-row"
            :full-colspan="fullColspan"
            :row="row.row"
            :sub-matches="subMatches"
            :keyField="keyField"
            :componentTestid="componentTestid"
            :i="i"
            :onRowMouseEnter="onRowMouseEnter"
            :onRowMouseLeave="onRowMouseLeave"
          >
            <tr
              v-if="row.row.stateDescription"
              :key="row.row[keyField] + '-description'"
              :data-testid="componentTestid + '-' + i + '-row-description'"
              class="state-description sub-row"
              @mouseenter="onRowMouseEnter"
              @mouseleave="onRowMouseLeave"
            >
              <td
                v-if="tableActions"
                class="row-check"
                align="middle"
              />
              <td
                :colspan="fullColspan - (tableActions ? 1: 0)"
                :class="{ 'text-error' : row.row.stateObj.error }"
              >
                {{ row.row.stateDescription }}
              </td>
            </tr>
          </slot>
        </template>
      </tbody>
    </table>
    <div
      v-if="showPaging"
      class="paging"
    >
      <button
        type="button"
        class="btn btn-sm role-multi-action"
        data-testid="pagination-first"
        :disabled="page == 1 || loading"
        @click="goToPage('first')"
      >
        <i class="icon icon-chevron-beginning" />
      </button>
      <button
        type="button"
        class="btn btn-sm role-multi-action"
        data-testid="pagination-prev"
        :disabled="page == 1 || loading"
        @click="goToPage('prev')"
      >
        <i class="icon icon-chevron-left" />
      </button>
      <span>
        {{ pagingDisplay }}
      </span>
      <button
        type="button"
        class="btn btn-sm role-multi-action"
        data-testid="pagination-next"
        :disabled="page == totalPages || loading"
        @click="goToPage('next')"
      >
        <i class="icon icon-chevron-right" />
      </button>
      <button
        type="button"
        class="btn btn-sm role-multi-action"
        data-testid="pagination-last"
        :disabled="page == totalPages || loading"
        @click="goToPage('last')"
      >
        <i class="icon icon-chevron-end" />
      </button>
    </div>
    <button
      v-if="search"
      v-shortkey.once="['/']"
      class="hide"
      @shortkey="focusSearch()"
    />
    <template v-if="tableActions">
      <button
        v-shortkey="['j']"
        class="hide"
        @shortkey="focusNext($event)"
      />
      <button
        v-shortkey="['k']"
        class="hide"
        @shortkey="focusPrevious($event)"
      />
      <button
        v-shortkey="['shift','j']"
        class="hide"
        @shortkey="focusNext($event, true)"
      />
      <button
        v-shortkey="['shift','k']"
        class="hide"
        @shortkey="focusPrevious($event, true)"
      />
      <slot name="shortkeys" />
    </template>
  </div>
</template>

<style lang="scss" scoped>
  .sortable-table.alt-loading {
    opacity: 0.5;
    pointer-events: none;
  }

  .manual-refresh {
    height: 40px;
  }
  .advanced-filter-group {
    position: relative;
    margin-left: 10px;
    .advanced-filter-container {
      position: absolute;
      top: 38px;
      right: 0;
      width: 300px;
      border: 1px solid var(--primary);
      background-color: var(--body-bg);
      padding: 20px;
      z-index: 2;

      .middle-block {
        display: flex;
        align-items: center;
        margin-top: 20px;

        span {
          margin-right: 20px;
        }

        button {
          margin-left: 20px;
        }
      }

      .bottom-block {
        display: flex;
        align-items: center;
        margin-top: 40px;
        justify-content: space-between;
      }
    }
  }

  .advanced-filters-applied {
    display: inline-flex;
    margin: 0;
    padding: 0;
    list-style: none;
    max-width: 100%;
    flex-wrap: wrap;
    justify-content: flex-end;

    li {
      margin: 0 20px 10px 0;
      padding: 2px 5px;
      border: 1px solid;
      display: flex;
      align-items: center;
      position: relative;
      height: 20px;

      &:nth-child(4n+1) {
        border-color: var(--success);

        .bg {
          background-color: var(--success);
        }
      }

      &:nth-child(4n+2) {
        border-color: var(--warning);

        .bg {
          background-color: var(--warning);
        }
      }

      &:nth-child(4n+3) {
        border-color: var(--info);

        .bg {
          background-color: var(--info);
        }
      }

      &:nth-child(4n+4) {
        border-color: var(--error);

        .bg {
          background-color: var(--error);
        }
      }

      .bg {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
       opacity: 0.2;
        z-index: -1;
      }

      .label {
        margin-right: 10px;
        font-size: 11px;
      }
     .cross {
        font-size: 12px;
        font-weight: bold;
        cursor: pointer;
      }
    }
  }

  // Remove colors from multi-action buttons in the table
  td {
    .actions.role-multi-action {
      background-color: transparent;
      border: none;
      &:hover, &:focus {
        background-color: var(--accent-btn);
        box-shadow: none;
      }
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

  // Loading indicator row
  tr td div.data-loading {
    align-items: center;
    display: flex;
    justify-content: center;
    padding: 20px 0;
    > i {
      font-size: 20px;
      height: 20px;
      margin-right: 5px;
      width: 20px;
    }
  }

  .search-box {
    height: 40px;
    margin-left: 10px;
    min-width: 180px;
  }
</style>

<style lang="scss">
  //
  // Important: Almost all selectors in here need to be ">"-ed together so they
  // apply only to the current table, not one nested inside another table.
  //

  $group-row-height: 40px;
  $group-separation: 40px;
  $divider-height: 1px;

  $separator: 20;
  $remove: 100;
  $spacing: 10px;

  .filter-select .vs__selected-options .vs__selected {
    text-align: left;
  }

  .sortable-table {
    border-collapse: collapse;
    min-width: 400px;
    border-radius: 5px 5px 0 0;
    outline: 1px solid var(--border);
    overflow: hidden;
    background: var(--sortable-table-bg);
    border-radius: 4px;

    &.overflow-x {
      overflow-x: visible;
    }
    &.overflow-y {
      overflow-y: visible;
    }

    td {
      padding: 8px 5px;
      border: 0;

      &:first-child {
        padding-left: 10px;
      }

      &:last-child {
        padding-right: 10px;
      }

      &.row-check {
        padding-top: 12px;
      }
    }

    tbody {
      tr {
        border-bottom: 1px solid var(--sortable-table-top-divider);
        background-color: var(--sortable-table-row-bg);

        &.main-row.has-sub-row {
          border-bottom: 0;
        }

        // if a main-row is hovered also hover it's sibling sub row. note - the reverse is handled in selection.js
        &.main-row:not(.row-selected):hover + .sub-row {
          background-color: var(--sortable-table-hover-bg);
        }

        &:last-of-type {
          border-bottom: 0;
        }

        &:hover, &.sub-row-hovered {
          background-color: var(--sortable-table-hover-bg);
        }

        &.state-description > td {
          font-size: 13px;
          padding-top: 0;
          overflow-wrap: anywhere;
        }
      }

      tr.active-row {
        color: var(--sortable-table-header-bg);
      }

      tr.row-selected {
        background: var(--sortable-table-selected-bg);
      }

      .no-rows {
        td {
          padding: 30px 0;
          text-align: center;
        }
      }

      .no-rows, .no-results {
        &:hover {
          background-color: var(--body-bg);
        }
      }

      &.group {
        &:before {
          content: "";
          display: block;
          height: 20px;
          background-color: transparent;
        }
      }

      tr.group-row {
        background-color: initial;

        &:first-child {
          border-bottom: 2px solid var(--sortable-table-row-bg);
        }

        &:not(:first-child) {
          margin-top: 20px;
        }

        td {
          padding: 0;

          &:first-of-type {
            border-left: 1px solid var(--sortable-table-accent-bg);
          }
        }

        .group-tab {
          @include clearfix;
          height: $group-row-height;
          line-height: $group-row-height;
          padding: 0 10px;
          border-radius: 4px 4px 0px 0px;
          background-color: var(--sortable-table-row-bg);
          position: relative;
          top: 1px;
          display: inline-block;
          z-index: z-index('tableGroup');
          min-width: $group-row-height * 1.8;

          > SPAN {
            color: var(--sortable-table-group-label);
          }
        }

        .group-tab:after {
          height: $group-row-height;
          width: 70px;
          border-radius: 5px 5px 0px 0px;
          background-color: var(--sortable-table-row-bg);
          content: "";
          position: absolute;
          right: -15px;
          top: 0px;
          transform: skewX(40deg);
          z-index: -1;
        }
      }
    }
  }

  .for-inputs{
    & TABLE.sortable-table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: $spacing;

    >TBODY>TR>TD, >THEAD>TR>TH {
      padding-right: $spacing;
      padding-bottom: $spacing;

      &:last-of-type {
        padding-right: 0;
      }
    }

    >TBODY>TR:first-of-type>TD {
      padding-top: $spacing;
    }

    >TBODY>TR:last-of-type>TD {
      padding-bottom: 0;
    }
  }

    &.edit, &.create, &.clone {
      TABLE.sortable-table>THEAD>TR>TH {
      border-color: transparent;
      }
    }
  }

  .sortable-table-header {
    position: relative;
    z-index: z-index('fixedTableHeader');

    &.titled {
      display: flex;
      align-items: center;
    }
  }
  .fixed-header-actions.button{
    grid-template-columns: [bulk] auto [middle] min-content [search] minmax(min-content, 350px);
  }

  .fixed-header-actions {
    padding: 0 0 20px 0;
    width: 100%;
    z-index: z-index('fixedTableHeader');
    background: transparent;
    display: grid;
    grid-template-columns: [bulk] auto [middle] min-content [search] minmax(min-content, 200px);
    grid-column-gap: 10px;

    &.advanced-filtering {
      grid-template-columns: [bulk] auto [middle] minmax(min-content, auto) [search] minmax(min-content, auto);
    }

    .bulk {
      grid-area: bulk;

      $gap: 10px;

      & > BUTTON {
        display: none; // Handled dynamically
      }

      & > BUTTON:not(:last-of-type) {
        margin-right: $gap;
      }

      .action-availability {
        display: none; // Handled dynamically
        margin-left: $gap;
        vertical-align: middle;
        margin-top: 2px;
      }

      .dropdown-button {
        $disabled-color: var(--disabled-text);
        $disabled-cursor: not-allowed;
        li.disabled {
          color: $disabled-color;
          cursor: $disabled-cursor;

          &:hover {
            color: $disabled-color;
            background-color: unset;
            cursor: $disabled-cursor;
          }
        }
      }

      .bulk-action  {
        .icon {
          vertical-align: -10%;
        }
      }
    }

    .middle {
      grid-area: middle;
      white-space: nowrap;

      .icon.icon-backup.animate {
        animation-name: spin;
        animation-duration: 1000ms;
        animation-iteration-count: infinite;
        animation-timing-function: linear;
      }

      @keyframes spin {
        from {
          transform:rotate(0deg);
        }
        to {
          transform:rotate(360deg);
        }
      }
    }

    .search {
      grid-area: search;
      text-align: right;
      justify-content: flex-end;
    }

    .bulk-actions-dropdown {
      display: none; // Handled dynamically

      .dropdown-button {
        background-color: var(--primary);

        &:hover {
          background-color: var(--primary-hover-bg);
          color: var(--primary-hover-text);
        }

        > *, .icon-chevron-down {
          color: var(--primary-text);
        }

        .button-divider {
          border-color: var(--primary-text);
        }

        &.disabled {
          border-color: var(--disabled-bg);

          .icon-chevron-down {
            color: var(--disabled-text) !important;
          }

          .button-divider {
            border-color: var(--disabled-text);
          }
        }
      }
    }
  }

  .paging {
    margin-top: 10px;
    text-align: center;

    SPAN {
      display: inline-block;
      min-width: 200px;
    }
  }
</style>
