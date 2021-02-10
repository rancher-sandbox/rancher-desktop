import { SEARCH_QUERY } from '@/config/query-params';
import { get } from '@/utils/object';
import { addObject, addObjects, isArray, removeAt } from '@/utils/array';

export default {
  data() {
    const searchQuery = this.$route.query.q || null;

    return { searchQuery };
  },

  computed: {
    searchFields() {
      const out = columnsToSearchField(this.columns);

      if ( this.extraSearchFields ) {
        addObjects(out, this.extraSearchFields);
      }

      return out;
    },

    /*
    subFields: computed('subHeaders.@each.{searchField,name}', 'extraSearchSubFields.[]', function() {
      let out = headersToSearchField(get(this, 'subHeaders'));

      return out.addObjects(get(this, 'extraSearchSubFields') || []);
    }),
    */

    filteredRows() {
      const out = (this.rows || []).slice();
      const searchText = (this.searchQuery || '').trim().toLowerCase();

      if ( !searchText.length ) {
        this.subMatches = null;

        return out;
      }

      const searchFields = this.searchFields;
      const searchTokens = searchText.split(/\s*[, ]\s*/);
      const subSearch = this.subSearch;
      const subFields = this.subFields;
      const subMatches = {};

      for ( let i = out.length - 1 ; i >= 0 ; i-- ) {
        const row = out[i];
        let hits = 0;
        let mainFound = true;

        for ( let j = 0 ; j < searchTokens.length ; j++ ) {
          let expect = true;
          let token = searchTokens[j];

          if ( token.substr(0, 1) === '!' ) {
            expect = false;
            token = token.substr(1);
          }

          if ( token && matches(searchFields, token, row) !== expect ) {
            mainFound = false;
            break;
          }
        }

        if ( subFields && subSearch) {
          const subRows = row[subSearch] || [];

          for ( let k = subRows.length - 1 ; k >= 0 ; k-- ) {
            let subFound = true;

            for ( let l = 0 ; l < searchTokens.length ; l++ ) {
              let expect = true;
              let token = searchTokens[l];

              if ( token.substr(0, 1) === '!' ) {
                expect = false;
                token = token.substr(1);
              }

              if ( matches(subFields, token, subRows[k]) !== expect ) {
                subFound = false;
                break;
              }
            }

            if ( subFound ) {
              hits++;
            }
          }

          subMatches[get(row, this.keyField)] = hits;
        }

        if ( !mainFound && hits === 0 ) {
          removeAt(out, i);
        }
      }

      this.subMatches = subMatches;

      return out;
    },
  },

  watch: {
    searchQuery(q) {
      this.$router.applyQuery({ [SEARCH_QUERY]: q || undefined });
    }
  },
};

function columnsToSearchField(columns) {
  const out = [];

  (columns || []).forEach((column) => {
    const field = column.search;

    if ( field ) {
      if ( typeof field === 'string' ) {
        addObject(out, field);
      } else if ( isArray(field) ) {
        addObjects(out, field);
      }
    } else if ( field === false ) {
      // Don't add the name
    } else {
      // Use value/name as the default
      addObject(out, column.value || column.name);
    }
  });

  return out.filter(x => !!x);
}

function matches(fields, token, item) {
  const tokenMayBeIp = /^[0-9a-f\.:]+$/i.test(token);

  for ( let i = 0 ; i < fields.length ; i++ ) {
    let field = fields[i];

    if ( field ) {
      const idx = field.indexOf(':');
      let modifier = null;

      if ( idx > 0 ) {
        modifier = field.substr(idx + 1);
        field = field.substr(0, idx);
      }

      let val = get(item, field);

      if ( val === undefined ) {
        continue;
      }
      val = (`${ val }`).toLowerCase();
      if ( !val ) {
        continue;
      }

      switch ( modifier ) {
      case 'exact':
        if ( val === token ) {
          return true;
        }
        break;

      case 'ip':
        if ( tokenMayBeIp ) {
          const re = new RegExp(`(?:^|\.)${ token }(?:\.|$)`);

          if ( re.test(val) ) {
            return true;
          }
        }
        break;

      case 'prefix':
        if ( val.indexOf(token) === 0) {
          return true;
        }
        break;

      default:
        if ( val.includes(token) ) {
          return true;
        }
      }
    }
  }

  return false;
}
