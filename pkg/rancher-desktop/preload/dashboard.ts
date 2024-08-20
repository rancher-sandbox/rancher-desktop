import { ipcRenderer } from '@pkg/utils/ipcRenderer';

export default async function initDashboard(): Promise<void> {
  const dashboardPort = await ipcRenderer.invoke('dashboard/get-port');
  if (!document.location.href.startsWith(`https://localhost:${ dashboardPort }/dashboard/`)) {
    return;
  }
  // Navigation API is only available in Chrome-derived browsers like Electron.
  // https://developer.mozilla.org/en-US/docs/Web/API/Navigation
  (window as any).navigation.addEventListener('navigate', async function onNavigate() {
    const resp = await fetch(`https://localhost:${ dashboardPort }/v3/users?me=true`);
    let loginSuccessful = false;

    if (resp.status === 401) {
      const token = await ipcRenderer.invoke('dashboard/get-csrf-token') ?? '';
      const loginURL = `https://localhost:${ dashboardPort }/v3-public/localProviders/local?action=login`;
      const resp = await fetch(loginURL, {
        headers: {
          'Accept': "application/json",
          'Content-Type': "application/json",
          'X-API-CSRF': token,
        },
        body: JSON.stringify({
          description: 'Rancher Desktop session',
          responseType: 'cookie',
          username: 'admin',
          password: 'password',
        }),
        method: "POST",
        credentials: "include"
      });
      loginSuccessful = resp.ok;
    }

    switch (location.pathname) {
      case '/dashboard/auth/login':
        // If we logged in, return to the page before the login form.
        if (loginSuccessful) {
          history.back();
        }
        return;
      case '/dashboard/home':
        // Whenever we go to home, replace with cluster explorer.
        location.pathname = '/dashboard/c/local/explorer';
        return;
    }
  });
  window.addEventListener('load', function() {
    const stylesheet = new CSSStyleSheet();
    // Hide the extensions navigation button.
    stylesheet.insertRule(`
      .side-menu div:has(> a.option[href="/dashboard/c/local/uiplugins"]) {
        display: none;
      }
    `);
    document.adoptedStyleSheets.push(stylesheet);
  });
}
