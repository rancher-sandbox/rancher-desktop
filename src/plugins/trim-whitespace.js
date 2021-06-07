import Vue from 'vue';

export function trimWhitespace(el, dir) {
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE ) {
      const trimmed = node.data.trim();

      if ( trimmed === '') {
        node.remove();
      } else if ( trimmed !== node.data ) {
        node.data = trimmed;
      }
    }
  }
}

export function trimWhitespaceSsr(el, dir) {
  // This causes server<->client dom mismatches sometimes... gave up for now.
  /*
  for ( const node of (el.children || []) ) {
    if ( node.text ) {
      const trimmed = node.text.trim();

      if ( trimmed !== node.text ) {
        node.text = trimmed;
      }
    } else if ( node.children ) {
      trimWhitespaceSsr(node);
    }
  }
  */
}

Vue.directive('trim-whitespace', {
  inserted:         trimWhitespace,
  componentUpdated: trimWhitespace
});
