export enum DiagnosticsCategory {
  Utilities = 'Utilities',
  Networking = 'Networking',
}

/**
 * DiagnosticsChecker describes an implementation of a single diagnostics check.
 */
export interface DiagnosticsChecker {
  /** Unique identifier for this check. */
  id: string;
  documentation: string,
  description: string,
  category: DiagnosticsCategory,
  /**
   * Preform the check.  Returns true if the check passed (i.e. things are
   * working correctly and does not need to be fixed).
   */
  check(): Promise<boolean>;
}

type DiagnosticsFix = {
  description: string
};

export type DiagnosticsResult = {
  id: string,
  documentation: string,
  description: string,
  category: DiagnosticsCategory,
  passed: boolean,
  mute: boolean,
  fixes: DiagnosticsFix[],
};

export type DiagnosticsResultGroup = {
  last_update: string,
  checks: Array<DiagnosticsResult>,
};

export class Diagnostics {
  /** Checkers capable of running individual diagnostics. */
  checkers: Promise<DiagnosticsChecker[]>;

  /** Time stamp of when the last check occurred. */
  lastUpdate = new Date(0);

  /** Last known check results. */
  results: Array<DiagnosticsResult> = [];

  /** Mapping of category name to diagnostic ids */
  categories: Partial<Record<DiagnosticsCategory, string[]>> = {};

  constructor(diagnostics?: DiagnosticsChecker[]) {
    this.checkers = diagnostics ? Promise.resolve(diagnostics) : (async() => {
      return (await Promise.all([
        import('./connectedToInternet'),
      ])).map(obj => obj.default);
    })();
    this.checkers.then((checkers) => {
      for (const checker of checkers) {
        this.results.push({
          id:            checker.id,
          documentation: checker.documentation,
          description:   checker.description,
          category:      checker.category,
          passed:        false,
          mute:          false,
          fixes:         [],
        });
        this.categories[checker.category] ??= [];
        this.categories[checker.category]?.push(checker.id);
      }
    });
  }

  /**
   * Returns the list of currently known category names.
   */
  getCategoryNames() {
    return Object.keys(this.categories);
  }

  /**
   * Returns undefined if the categoryName isn't known, the list of IDs in that category otherwise.
   */
  getIdsForCategory(categoryName: string): Array<string>|undefined {
    return this.categories[categoryName as DiagnosticsCategory];
  }

  /**
   * Fetch the last known results, filtered by given category and id.
   */
  getChecks(categoryName: string|null, id: string|null): DiagnosticsResultGroup {
    return {
      last_update: this.lastUpdate.toISOString(),
      checks:      this.results
        .filter(check => categoryName ? check.category === categoryName : true)
        .filter(check => id ? check.id === id : true),
    };
  }

  /**
   * Run all checks, and return the results.
   */
  async runChecks(): Promise<DiagnosticsResultGroup> {
    await Promise.all((await this.checkers).map(async(checker) => {
      const result = this.results.find(result => result.id === checker.id);

      if (result) {
        result.passed = await checker.check();
      }
    }));
    this.lastUpdate = new Date();

    return {
      last_update: this.lastUpdate.toISOString(),
      checks:      this.results,
    };
  }
}
