function trimWhitespace(el, dir) {
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

export default {
  name: 'trim-whitespace-directive',
  install(app) {
    app.directive('trim-whitespace', {
      mounted: trimWhitespace,
      updated: trimWhitespace,
    });
  },
};
