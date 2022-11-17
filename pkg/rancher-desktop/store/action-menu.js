import { filterBy, isArray } from '@pkg/utils/array';

export const state = function() {
  return {
    show:              false,
    tableSelected:     [],
    tableAll:          [],
    resources:         [],
    elem:              null,
    event:             null,
    showPromptMove:    false,
    showPromptRemove:  false,
    showPromptRestore: false,
    showAssignTo:      false,
    showPromptUpdate:  false,
    showModal:         false,
    toMove:            [],
    toRemove:          [],
    toRestore:         [],
    toAssign:          [],
    toUpdate:          [],
    modalData:         {},
  };
};

export const getters = {
  showing:       state => state.show,
  elem:          state => state.elem,
  event:         state => state.event,
  tableSelected: state => state.tableSelected || [],

  options(state) {
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

  isSelected: state => (resource) => {
    return state.tableSelected.includes(resource);
  },
};

export const mutations = {
  show(state, { resources, elem, event }) {
    if ( !isArray(resources) ) {
      resources = [resources];
    }

    state.resources = resources;
    state.elem = elem;
    state.event = event;
    state.show = true;
  },

  hide(state) {
    state.show = false;
    state.resources = null;
    state.elem = null;
  },

  togglePromptRemove(state, resources) {
    if (!resources) {
      state.showPromptRemove = false;
      resources = [];
    } else {
      state.showPromptRemove = !state.showPromptRemove;
      if (!isArray(resources)) {
        resources = [resources];
      }
    }
    state.toRemove = resources;
  },

  togglePromptMove(state, resources) {
    if (!resources) {
      state.showPromptMove = false;
      resources = [];
    } else {
      state.showPromptMove = !state.showPromptMove;
      state.toMove = Array.isArray(resources) ? resources : [resources];
    }
  },

  togglePromptRestore(state, resources) {
    if (!resources) {
      state.showPromptRestore = false;
      resources = [];
    } else {
      state.showPromptRestore = !state.showPromptRestore;
      if (!isArray(resources)) {
        resources = [resources];
      }
    }
    state.toRestore = resources;
  },

  toggleAssignTo(state, resources) {
    state.showAssignTo = !state.showAssignTo;

    if (!isArray(resources)) {
      resources = [resources];
    }

    state.toAssign = resources;
  },

  togglePromptUpdate(state, resources) {
    if (!resources) {
      // Clearing the resources also hides the prompt
      state.showPromptUpdate = false;
    } else {
      state.showPromptUpdate = !state.showPromptUpdate;
    }

    if (!isArray(resources)) {
      resources = [resources];
    }

    state.toUpdate = resources;
  },

  togglePromptModal(state, data) {
    if (!data) {
      // Clearing the resources also hides the prompt
      state.showModal = false;
    } else {
      state.showModal = true;
    }

    state.modalData = data;
  },
};

export const actions = {
  executeTable({ state }, { action, args }) {
    return _execute(state.tableSelected, action, args);
  },

  execute({ state }, { action, args, opts }) {
    return _execute(state.resources, action, args, opts);
  },
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
