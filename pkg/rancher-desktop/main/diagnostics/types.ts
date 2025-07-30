export enum DiagnosticsCategory {
  ContainerEngine = 'Container Engine',
  Kubernetes = 'Kubernetes',
  Networking = 'Networking',
  Utilities = 'Utilities',
  Testing = 'Testing',
}

interface DiagnosticsFix {
  /** A textual description of the fix to be displayed to the user. */
  description: string;
}

/**
 * DiagnosticsCheckerResult is the result for running a given diagnostics
 * checker.
 */
export interface DiagnosticsCheckerResult {
  /** Link to documentation about this check. */
  documentation?: string,
  /** User-visible markdown description about this check. */
  description:    string,
  /** If true, the check succeeded (no fixes need to be applied). */
  passed:         boolean,
  /** Potential fixes when this check fails. */
  fixes:          DiagnosticsFix[],
}

export type DiagnosticsCheckerSingleResult = DiagnosticsCheckerResult & {
  /**
   * For checkers returning multiple results, each result must have its own
   * identifier that is consistent over checker runs.
   */
  id: string;
};

/**
 * DiagnosticsChecker describes an implementation of a diagnostics checker.
 * The checker may return one or more results.
 */
export interface DiagnosticsChecker {
  /** Unique identifier for this check. */
  id:       string;
  category: DiagnosticsCategory,
  /**
   * Whether any of the checks this checker supports should be used on this
   * system.
   */
  applicable(): Promise<boolean>,
  /**
   * Perform the check.  If this checker does multiple checks, any checks that
   * are not applicable on this system should be skipped (rather than returning
   * a failing result).
   */
  check(): Promise<DiagnosticsCheckerResult | DiagnosticsCheckerSingleResult[]>;
}
