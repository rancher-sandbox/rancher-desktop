import { isArray, filterBy, removeObjects, addObjects } from '@/utils/array';

export const state = function() {
  return {
    show:             false,
    tableSelected:    [],
    tableAll:         [],
    resources:        [],
    elem:             null,
    event:            null,
    actionOfInterest: null
  };
};

// default to initial state in args below in case something is called before registerModule
const stateSchema = state();

export const getters = {
  showing:       (state = stateSchema) => state.show,
  elem:          (state = stateSchema) => state.elem,
  event:         (state = stateSchema) => state.event,
  tableSelected: (state = stateSchema) => state.tableSelected || [],

  forTable(state = stateSchema) {
    let disableAll = false;
    let selected = state.tableSelected;
    const all = state.tableAll;

    if ( !selected ) {
      return [];
    }

    if ( !selected.length ) {
      if ( !all ) {
        return [];
      }

      const firstNode = all[0];

      selected = firstNode ? [firstNode] : [];
      disableAll = true;
    }

    const map = {};

    // Find and add all the actions for all the nodes so that we know
    // what all the possible actions are
    for ( const node of all ) {
      if (node.availableActions) {
        for ( const act of node.availableActions ) {
          if ( act.bulkable ) {
            _add(map, act, false);
          }
        }
      }
    }

    // Go through all the selected items and add the actions (which were already identified above)
    // as availalable for some (or all) of the selected nodes
    for ( const node of selected ) {
      if (node.availableActions) {
        for ( const act of node.availableActions ) {
          if ( act.bulkable && act.enabled ) {
            _add(map, act, false);
          }
        }
      }
    }

    // If there's no items actually selected, we want to see all the actions
    // so you know what exists, but have them all be disabled since there's nothing to do them on.
    const out = _filter(map, disableAll);

    // Enable a bulkaction if some of the selected items can perform the action
    out.forEach((bulkAction) => {
      const actionEnabledForSomeSelected = state.tableSelected.some((node) => {
        const availableActions = node.availableActions || [];

        return availableActions.some(action => action.action === bulkAction.action && action.enabled);
      });

      bulkAction.enabled = state.tableSelected.length > 0 && actionEnabledForSomeSelected;
    });

    return out.sort((a, b) => (b.weight || 0) - (a.weight || 0));
  },

  options(state = stateSchema) {
    let selected = state.resources;

    if ( !selected ) {
      return [];
    }

    if ( !isArray(selected) ) {
      selected = [];
    }

    const map = {};

    for ( const node of selected ) {
      if (node.availableActions) {
        for ( const act of node.availableActions ) {
          _add(map, act);
        }
      }
    }

    const out = _filter(map);

    return { ...out };
  },

  isSelected: (state = stateSchema) => (resource) => {
    return state.tableSelected.includes(resource);
  },

  canRunBulkActionOfInterest: (state = stateSchema) => (resource) => {
    if (!state.actionOfInterest) {
      return false;
    }

    const matchingResourceAction = resource.availableActions.find(action => action.action === state.actionOfInterest.action);

    return matchingResourceAction?.enabled;
  }
};

export const mutations = {
  setTable(state = stateSchema, { table, clearSelection = false }) {
    const selected = state.tableSelected;

    state.tableAll = table;

    if ( clearSelection ) {
      state.tableSelected = [];
    } else {
      // Remove items that are no longer visible from the selection
      const toRemove = [];

      for ( const cur of state.tableSelected ) {
        if ( !table.includes(cur) ) {
          toRemove.push(cur);
        }
      }

      removeObjects(selected, toRemove);
    }
  },

  update(state = stateSchema, { toAdd, toRemove }) {
    const selected = state.tableSelected || [];

    if (toRemove && toRemove.length) {
      removeObjects(selected, toRemove);
    }

    if (toAdd.length) {
      addObjects(selected, toAdd);
    }
  },

  show(state = stateSchema, { resources, elem, event }) {
    if ( !isArray(resources) ) {
      resources = [resources];
    }

    state.resources = resources;
    state.elem = elem;
    state.event = event;
    state.show = true;
  },

  hide(state = stateSchema) {
    state.show = false;
    state.resources = null;
    state.elem = null;
  },

  setBulkActionOfInterest(state = stateSchema, action) {
    if (!action || action.enabled) {
      state.actionOfInterest = action;
    }
  },
};

export const actions = {
  executeTable({ state }, { action, args, opts }) {
    const executableSelection = state.tableSelected.filter(getters.canRunBulkActionOfInterest(state));

    return _execute(executableSelection, action, args, opts);
  },

  execute({ state }, { action, args }) {
    return _execute(state.resources, action, args);
  },
};

export default {
  state, actions, getters, mutations, namespaced: true
};

// -----------------------------

let anon = 0;

function _add(map, act, incrementCounts = true) {
  let id = act.action;

  if ( !id ) {
    id = `anon${ anon }`;
    anon++;
  }

  let obj = map[id];

  if ( !obj ) {
    obj = Object.assign({}, act);
    map[id] = obj;
    obj.allEnabled = false;
  }

  if ( act.enabled === false ) {
    obj.allEnabled = false;
  } else {
    obj.anyEnabled = true;
  }

  if ( incrementCounts ) {
    obj.available = (obj.available || 0) + (act.enabled === false ? 0 : 1 );
    obj.total = (obj.total || 0) + 1;
  }

  return obj;
}

function _filter(map, disableAll = false) {
  const out = filterBy(Object.values(map), 'anyEnabled', true);

  for ( const act of out ) {
    if ( disableAll ) {
      act.enabled = false;
    } else {
      act.enabled = ( act.available >= act.total );
    }
  }

  return out;
}

function _execute(resources, action, args, opts = {}) {
  args = args || [];
  if ( resources.length > 1 && action.bulkAction && !opts.alt ) {
    const fn = resources[0][action.bulkAction];

    if ( fn ) {
      return fn.call(resources[0], resources, ...args);
    }
  }

  const promises = [];

  for ( const resource of resources ) {
    let fn;

    if (opts.alt && action.altAction) {
      fn = resource[action.altAction];
    } else {
      fn = resource[action.action];
    }

    if ( fn ) {
      promises.push(fn.apply(resource, args));
    }
  }

  return Promise.all(promises);
}
