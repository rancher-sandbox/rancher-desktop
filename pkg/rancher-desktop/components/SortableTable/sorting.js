import { sortBy } from '@pkg/utils/sort';
import { uniq } from '@pkg/utils/array';

/**
 * Always sort by something, this is the best guess on properties
 *
 * Can be overridden
 */
const DEFAULT_MANDATORY_SORT = ['nameSort', 'id'];

export default {
  computed: {
    sortFields() {
      let fromGroup = ( this.groupBy ? this.groupSort || this.groupBy : null) || [];
      let fromColumn = [];

      const column = (this.columns || this.headers).find((x) => x && x.name && x.name.toLowerCase() === this.sortBy.toLowerCase());

      if ( this.sortBy && column && column.sort ) {
        fromColumn = column.sort;
      }

      if ( !Array.isArray(fromGroup) ) {
        fromGroup = [fromGroup];
      }

      if ( !Array.isArray(fromColumn) ) {
        fromColumn = [fromColumn];
      }

      // return the sorting based on grouping, user selection and fallback
      return uniq([...fromGroup, ...fromColumn].concat(...(this.mandatorySort || DEFAULT_MANDATORY_SORT)));
    },

    arrangedRows() {
      if (this.externalPaginationEnabled) {
        return;
      }

      let key;

      if ( this.sortGenerationFn ) {
        key = `${ this.sortGenerationFn.apply(this) }/${ this.rows.length }/${ this.descending }/${ this.sortFields.join(',') }`;

        if ( this.cacheKey === key ) {
          return this.cachedRows;
        }
      }

      const out = sortBy(this.rows, this.sortFields, this.descending);

      if ( key ) {
        this.cacheKey = key;
        this.cachedRows = out;
      }

      return out;
    },
  },

  data() {
    let sortBy = null;

    this._defaultSortBy = this.defaultSortBy;

    // Try to find a reasonable default sort
    if ( !this._defaultSortBy ) {
      const markedColumn = this.headers.find((x) => !!x.defaultSort);
      const nameColumn = this.headers.find( (x) => x.name === 'name');

      if ( markedColumn ) {
        this._defaultSortBy = markedColumn.name;
      } else if ( nameColumn ) {
        // Use the name column if there is one
        this._defaultSortBy = nameColumn.name;
      } else {
        // The first column that isn't state
        const first = this.headers.filter( (x) => x.name !== 'state' )[0];

        if ( first ) {
          this._defaultSortBy = first.name;
        } else {
          // I give up
          this._defaultSortBy = 'id';
        }
      }
    }

    // If the sort column doesn't exist or isn't specified, use default
    if ( !sortBy || !this.headers.find((x) => x.name === sortBy ) ) {
      sortBy = this._defaultSortBy;
    }

    return {
      sortBy,
      descending: false,
      cachedRows: null,
      cacheKey:   null,
    };
  },

  methods: {
    changeSort(sort, desc) {
      this.sortBy = sort;
      this.descending = desc;

      // Always go back to the first page when the sort is changed
      this.setPage(1);
    },
  },

  watch: {
    sortFields() {
      this.debouncedPaginationChanged();
    },

    descending() {
      this.debouncedPaginationChanged();
    }
  }
};
