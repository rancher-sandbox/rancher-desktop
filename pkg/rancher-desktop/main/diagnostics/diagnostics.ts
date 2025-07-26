import { DiagnosticsCategory, DiagnosticsChecker, DiagnosticsCheckerResult, DiagnosticsCheckerSingleResult } from './types';

import mainEvents from '@pkg/main/mainEvents';
import Logging from '@pkg/utils/logging';
import { send } from '@pkg/window';

const console = Logging.diagnostics;

/**
 * DiagnosticsResult is the data structure that will be returned to clients (as
 * part of a DiagnosticsResultCollection) over the HTTP API.
 */
export type DiagnosticsResult = DiagnosticsCheckerResult & {
  /** The diagnostics checker that produced this result. */
  id:       string,
  /** Whether to avoid notifying the user about failures for this check. */
  mute:     boolean,
  category: DiagnosticsCategory,
};

/**
 * DiagnosticsResultCollection is the data structure that will be returned to
 * clients over the HTTP API.
 */
export interface DiagnosticsResultCollection {
  last_update: string,
  checks:      DiagnosticsResult[],
}

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
  results: Record<DiagnosticsChecker['id'], DiagnosticsCheckerResult | DiagnosticsCheckerSingleResult[]> = {};

  updateTimeout: ReturnType<typeof setTimeout> | undefined;

  /** Mapping of category name to diagnostic ids */
  readonly checkerIdByCategory: Partial<Record<DiagnosticsCategory, string[]>> = {};

  constructor(diagnostics?: DiagnosticsChecker[]) {
    this.checkers = diagnostics
      ? Promise.resolve(diagnostics)
      : (async() => {
        const imports = (await Promise.all([
          import('./connectedToInternet'),
          import('./dockerCliSymlinks'),
          import('./integrationsWindows'),
          import('./kubeConfigSymlink'),
          import('./kubeContext'),
          import('./kubeVersionsAvailable'),
          import('./limaDarwin'),
          import('./mockForScreenshots'),
          import('./pathManagement'),
          import('./rdBinInShell'),
          import('./testCheckers'),
          import('./wslFromStore'),
        ])).map(obj => obj.default);

        return (await Promise.all(imports)).flat();
      })();
    this.checkers.then((checkers) => {
      for (const checker of checkers) {
        this.checkerIdByCategory[checker.category] ??= [];
        this.checkerIdByCategory[checker.category]?.push(checker.id);
      }
    });

    mainEvents.handle('diagnostics-trigger', async(id) => {
      const checker = (await this.checkers).find(checker => checker.id === id);

      if (checker) {
        await this.runChecker(checker);

        return this.results[checker.id];
      }
    });
  }

  /**
   * Returns the list of currently known category names.
   */
  getCategoryNames(): string[] {
    return Object.keys(this.checkerIdByCategory);
  }

  /**
   * Returns undefined if the categoryName isn't known, the list of IDs in that category otherwise.
   */
  getIdsForCategory(categoryName: string): string[] | undefined {
    return this.checkerIdByCategory[categoryName as DiagnosticsCategory];
  }

  protected async applicableCheckers(categoryName: string | null, id: string | null): Promise<DiagnosticsChecker[]> {
    const checkerId = id?.split(':', 1)[0];
    const checkers = (await this.checkers)
      .filter(checker => categoryName ? checker.category === categoryName : true)
      .filter(checker => checkerId ? checker.id === checkerId : true);

    return (await Promise.all(checkers.map(async(checker) => {
      try {
        return [checker, await checker.applicable()] as const;
      } catch (ex) {
        console.error(`Failed to check ${ checker.id }: ${ ex }`);

        return [checker, false] as const;
      }
    })))
      .map(([checker, applicable]) => {
        console.debug(`${ checker.id } is ${ applicable ? '' : 'not ' }applicable`);

        return [checker, applicable] as const;
      })
      .filter(([, applicable]) => applicable)
      .map(([checker]) => checker);
  }

  /**
   * Fetch the last known results, filtered by given category and id.
   */
  async getChecks(categoryName: string | null, id: string | null): Promise<DiagnosticsResultCollection> {
    const checkers = (await this.applicableCheckers(categoryName, id))
      .filter(checker => checker.id in this.results);

    return {
      last_update: this.lastUpdate.toISOString(),
      checks:      checkers
        .flatMap((checker) => {
          const result = this.results[checker.id];

          if (Array.isArray(result)) {
            return result.map(result => ({
              ...result,
              id:       `${ checker.id }:${ result.id }`,
              category: checker.category,
              mute:     false,
            }));
          } else {
            return {
              ...result,
              id:       checker.id,
              category: checker.category,
              mute:     false,
            };
          }
        }),
    };
  }

  /**
   * Run the given diagnostics checker, updating its result.
   */
  protected async runChecker(checker: DiagnosticsChecker) {
    console.debug(`Running check ${ checker.id }`);
    try {
      const result = await checker.check();

      this.results[checker.id] = result;
      if (Array.isArray(result)) {
        for (const singleResult of result) {
          console.debug(`Check ${ checker.id }:${ singleResult.id } result: ${ JSON.stringify(singleResult) }`);
        }
      } else {
        console.debug(`Check ${ checker.id } result: ${ JSON.stringify(result) }`);
      }
    } catch (e) {
      console.error(`ERROR checking ${ checker.id }`, { e });
    }

    if (this.updateTimeout !== undefined) {
      clearTimeout(this.updateTimeout);
    }
    this.updateTimeout = setTimeout(() => send('diagnostics/update'), 500);
  }

  /**
   * Run all checks, and return the results.
   */
  async runChecks(): Promise<DiagnosticsResultCollection> {
    await Promise.all((await this.applicableCheckers(null, null)).map(async(checker) => {
      await this.runChecker(checker);
    }));
    this.lastUpdate = new Date();

    return this.getChecks(null, null);
  }
}
