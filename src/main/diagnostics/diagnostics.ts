import DIAGNOSTICS_TABLE from '@/assets/diagnostics.yaml';

type DiagnosticsFix = {
  fixes: { description: string }
};

export type DiagnosticsCheck = {
  id: string,
  documentation: string,
  description: string,
  category: string,
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
   * Returns an array of all matching checkObjects, depending on which of categoryName and id are specified.
   */
  getChecks(categoryName: string|null, id: string|null): DiagnosticsCheck[] {
    if (categoryName) {
      const checksByCategory = this.checksByCategory[categoryName];

      if (!checksByCategory) {
        return [];
      } else if (!id) {
        return augmentChecks(categoryName, checksByCategory);
      } else {
        return augmentChecks(categoryName, checksByCategory.filter(check => check.id === id));
      }
    }
    let finalChecks: DiagnosticsCheck[] = [];

    for (const category in this.checksByCategory) {
      let checks = this.checksByCategory[category];

      if (id) {
        checks = checks.filter(check => check.id === id);
      }
      finalChecks = finalChecks.concat(augmentChecks(category, checks));
    }

    return finalChecks;
  }
}

function augmentChecks(category: string, checks: DiagnosticsCheck[]): DiagnosticsCheck[] {
  return checks.map((check) => {
    check.category = category;
    check.fixes ??= [];

    return check;
  });
}
