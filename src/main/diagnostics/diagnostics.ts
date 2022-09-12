export enum DiagnosticsCategory {
  Utilities = 'Utilities',
  Networking = 'Networking',
}

/**
 * DiagnosticsCheckerResult is the result for running a given diagnostics
 * checker.
 */
type DiagnosticsCheckerResult = {
  /* Link to documentation about this check. */
  documentation: string,
  /* User-visible description about this check. */
  description: string,
  /** If true, the check succeeded (no fixes need to be applied). */
  passed: boolean,
  /** Potential fixes when this check fails. */
  fixes: DiagnosticsFix[],
};

/**
 * DiagnosticsChecker describes an implementation of a single diagnostics check.
 */
export interface DiagnosticsChecker {
  /** Unique identifier for this check. */
  id: string;
  category: DiagnosticsCategory,
  /** Whether this checker should be used on this system. */
  applicable(): Promise<boolean>,
  /**
   * A function that the checker can call to force this check to be updated.
   * This does not change the global last-checked timestamp.
   */
  trigger?: (checker: DiagnosticsChecker) => void,
  /**
   * Perform the check.
   */
  check(): Promise<DiagnosticsCheckerResult>;
}

type DiagnosticsFix = {
  /** A textual description of the fix to be displayed to the user. */
  description: string;
};

/**
 * DiagnosticsResult is the data structure that will be returned to clients (as
 * part of a DiagnosticsResultCollection) over the HTTP API.
 */
export type DiagnosticsResult = DiagnosticsCheckerResult & {
  /** The diagnostics checker that produced this result. */
  id: string,
  /** Whether to avoid notifying the user about failures for this check. */
  mute: boolean,
  category: DiagnosticsCategory,
};

/**
 * DiagnosticsResultCollection is the data structure that will be returned to
 * clients over the HTTP API.
 */
export type DiagnosticsResultCollection = {
  last_update: string,
  checks: Array<DiagnosticsResult>,
};

/**
 * DiagnosticsManager manages the collection of diagnostics checkers, and is
 * used to run checks and fetch results.
 */
export class DiagnosticsManager {
  /** Checkers capable of running individual diagnostics. */
  readonly checkers: Promise<DiagnosticsChecker[]>;

  /** Time stamp of when the last check occurred. */
  lastUpdate = new Date(0);

  /** Last known check results, indexed by the checker id. */
  results: Record<DiagnosticsChecker['id'], DiagnosticsCheckerResult> = {};

  /** Mapping of category name to diagnostic ids */
  readonly checkerIdByCategory: Partial<Record<DiagnosticsCategory, string[]>> = {};

  constructor(diagnostics?: DiagnosticsChecker[]) {
    this.checkers = diagnostics ? Promise.resolve(diagnostics) : (async() => {
      const imports = (await Promise.all([
        import('./connectedToInternet'),
        import('./dockerCliSymlinks'),
        import('./rdBinInShell'),
      ])).map(obj => obj.default);
      const checkers = (await Promise.all(imports)).flat();
      const checkersApplicable = await Promise.all(checkers.map(async(checker) => {
        return [checker, await checker.applicable()] as const;
      }));

      return checkersApplicable.filter(([_, applicable]) => applicable).map(([checker]) => checker);
    })();
    this.checkers.then((checkers) => {
      for (const checker of checkers) {
        checker.trigger = async(checker) => {
          this.results[checker.id] = await checker.check();
        };
        this.checkerIdByCategory[checker.category] ??= [];
        this.checkerIdByCategory[checker.category]?.push(checker.id);
      }
    });
  }

  /**
   * Returns the list of currently known category names.
   */
  getCategoryNames(): Array<string> {
    return Object.keys(this.checkerIdByCategory);
  }

  /**
   * Returns undefined if the categoryName isn't known, the list of IDs in that category otherwise.
   */
  getIdsForCategory(categoryName: string): Array<string>|undefined {
    return this.checkerIdByCategory[categoryName as DiagnosticsCategory];
  }

  /**
   * Fetch the last known results, filtered by given category and id.
   */
  async getChecks(categoryName: string|null, id: string|null): Promise<DiagnosticsResultCollection> {
    return {
      last_update: this.lastUpdate.toISOString(),
      checks:      (await this.checkers)
        .filter(checker => categoryName ? checker.category === categoryName : true)
        .filter(checker => id ? checker.id === id : true)
        .filter(checker => checker.id in this.results)
        .map(checker => ({
          ...this.results[checker.id],
          id:       checker.id,
          category: checker.category,
          mute:     false,
        })),
    };
  }

  /**
   * Run all checks, and return the results.
   */
  async runChecks(): Promise<DiagnosticsResultCollection> {
    await Promise.all((await this.checkers).map(async(checker) => {
      this.results[checker.id] = await checker.check();
    }));
    this.lastUpdate = new Date();

    return this.getChecks(null, null);
  }
}
