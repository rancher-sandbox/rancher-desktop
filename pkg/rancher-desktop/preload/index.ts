import initExtensions from './extensions';

function init() {
  initExtensions();
}

try {
  init();
} catch (ex) {
  console.error(ex);
  throw ex;
}
