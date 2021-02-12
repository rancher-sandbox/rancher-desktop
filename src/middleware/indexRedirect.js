/**
 * This middleware redirects / to /Welcome
 */
export default ({ route, next, redirect }) => {
  switch (route.path) {
  case '/':
    redirect(301, '/Welcome');
    break;
  default:
    next();
  }
};
