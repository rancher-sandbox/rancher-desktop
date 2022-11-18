class HelpImpl {
  url(key: string | undefined): string {
    // ToDo , to map urls with key
    return 'https://docs.rancherdesktop.io';
  }
}

export const Help = new HelpImpl();
