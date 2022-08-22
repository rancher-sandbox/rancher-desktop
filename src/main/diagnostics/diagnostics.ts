import DIAGNOSTICS_TABLE from '@/assets/diagnostics.yaml';

type DiagnosticsFix = {
  fixes: { description: string }
};

export type DiagnosticsCheck = {
  id: string,
  documentation: string,
  description: string,
  mute: boolean,
  fixes: DiagnosticsFix[],
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
      for (const check of category.checks) {
        check.mute ??= false;
        check.fixes ??= [];
      }
      this.checksByCategory[category.title] = category.checks;
    }
  }

  /**
   * Returns the list of currently known category names.
   */
  getCategoryNames() {
    return Object.keys(this.checksByCategory);
  }

  /**
   * @param categoryName {string}
   * Returns unknown if the categoryName isn't known, the list of IDs in that category otherwise.
   */
  getIdsForCategory(categoryName: string): Array<string>|undefined {
    return this.checksByCategory[categoryName]?.map(category => category.id);
  }

  /**
   * @param categoryName {string}
   * @param id {string}
   * Returns {unknown} if the categoryName isn't known or id not in that category, the check object otherwise.
   */
  getCheckByID(categoryName: string, id: string): DiagnosticsCheck {
    return this.checksByCategory[categoryName]?.filter(check => check.id === id)[0];
  }
}
