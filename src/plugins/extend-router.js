import VueRouter from 'vue-router';
import isEqual from 'lodash/isEqual';

VueRouter.prototype.applyQuery = function(qp, defaults = {}) {
  const query = queryParamsFor(this.currentRoute.query, qp, defaults);
  const hash = this.currentRoute.hash || '';

  if ( isEqual(query, this.currentRoute.query) ) {
    return;
  }

  return this.replace({ query, hash }).catch((err) => {
    if ( err?.name === 'NavigationDuplicated' ) {
      // Do nothing, this is fine...
      // https://github.com/vuejs/vue-router/issues/2872
    } else {
      throw err;
    }
  });
};

export function queryParamsFor(current, qp, defaults = {}) {
  const query = Object.assign({}, current || {});

  for ( const key of Object.keys(qp) ) {
    const val = qp[key];

    if ( typeof defaults[key] === 'undefined' ) {
      // There is no default
      query[key] = qp[key];
    } else if ( defaults[key] === false ) {
      // Value-less boolean flags
      if ( val ) {
        query[key] = null;
      } else {
        delete query[key];
      }
    } else if ( val === defaults[key] ) {
      // The value is the default
      delete query[key];
    } else {
      // The value is not the default
      query[key] = val;
    }
  }

  return query;
}
