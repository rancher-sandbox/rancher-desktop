import initDashboard from './dashboard';
import initExtensions from './extensions';

function init() {
  initExtensions();
  initDashboard();
}

try {
  init();
} catch (ex) {
  console.error(ex);
  throw ex;
}
