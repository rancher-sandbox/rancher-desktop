import yaml from 'yaml';

import DIAGNOSTICS_TABLE from '@/assets/diagnostics.yaml';

type DiagnosticsFix = {
  fixes: Record<'description', string>
};

type DiagnosticsCheck = {
  id: string,
  documentation: string,
  description: string,
  mute: boolean,
  fixes: DiagnosticsFix,
};

type DiagnosticsCategories = {
  title: string,
  checks: Array<DiagnosticsCheck>,
};

type DiagnosticsType = {
  last_update: string
  categories: Array<DiagnosticsCategories>,
};

export class Diagnostics {
  diagnostics: DiagnosticsType;
  checksByCategory: Record<string, Array<DiagnosticsCheck>> = {};
  constructor(diagnosticsTable: DiagnosticsType|undefined = undefined) {
    this.diagnostics = diagnosticsTable || DIAGNOSTICS_TABLE.diagnostics;
    for (const category of this.diagnostics.categories) {
      this.checksByCategory[category.title] = category.checks;
    }
  }

  getCategoryNames() {
    return Object.keys(this.checksByCategory);
  }

  getIdsForCategory(categoryName: string): Array<string>|undefined {
    return this.checksByCategory[categoryName]?.map(category => category.id);
  }

  getCheckByID(categoryName: string, id: string) {
    return this.checksByCategory[categoryName]?.filter(check => check.id === id)[0];
  }
}
