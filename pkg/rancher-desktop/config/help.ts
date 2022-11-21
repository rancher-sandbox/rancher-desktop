class HelpImpl {
  url(key: string | undefined): string {
    // TODO: to map URLs with key
    return 'https://docs.rancherdesktop.io';
  }
}

export const Help = new HelpImpl();
