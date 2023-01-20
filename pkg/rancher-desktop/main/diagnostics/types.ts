export enum DiagnosticsCategory {
  ContainerEngine = 'Container Engine',
  Kubernetes = 'Kubernetes',
  Networking = 'Networking',
  Utilities = 'Utilities',
  Testing = 'Testing',
}

type DiagnosticsFix = {
  /** A textual description of the fix to be displayed to the user. */
  description: string;
};

/**
 * DiagnosticsCheckerResult is the result for running a given diagnostics
 * checker.
 */
export type DiagnosticsCheckerResult = {
  /* Link to documentation about this check. */
  documentation?: string,
  /* User-visible markdown description about this check. */
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
   * Perform the check.
   */
  check(): Promise<DiagnosticsCheckerResult>;
}
