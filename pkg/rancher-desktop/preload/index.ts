import initDashboard from './dashboard';
import initExtensions from './extensions';

function init() {
  initExtensions();
  initDashboard().catch(ex => console.error(ex));
}

try {
  init();
} catch (ex) {
  console.error(ex);
  throw ex;
}
