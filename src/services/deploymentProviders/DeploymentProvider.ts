/**
 * Deployment Provider abstraction (§21).
 *
 * The rollback ORCHESTRATION layer (systemVersionService.ts) never talks to
 * a deployment platform directly - it only calls this interface, so the
 * infrastructure can change later (Cloudflare Pages, GitHub Actions, another
 * host) without touching the checkpoint/audit/health-check/permission logic.
 *
 * CRITICAL (§19/§20): no implementation of this interface may hold or
 * receive a GitHub token, Cloudflare API token, or any other deployment
 * credential inside this frontend bundle. A REAL automated implementation
 * (e.g. CloudflarePagesProvider) would call a secure SERVER-SIDE endpoint
 * (a Cloudflare Worker or similar) that itself holds the credential - the
 * browser only ever sends a permission-checked request to that endpoint and
 * receives a result back. See ManualDeploymentProvider for why no such
 * backend is wired by default in this codebase.
 */

export interface DeploymentTarget {
  commitSha: string;
  branch: string;
  environment: 'production' | 'staging' | 'development';
  versionLabel: string;
}

export interface DeploymentResult {
  /** True only once the deployment platform confirms the target commit is actually live - never optimistically true. */
  success: boolean;
  /** True when this provider cannot execute the deployment itself and a human must complete it outside the app (§20's "Secure Rollback API" step not being wired) - the rollback stays in RUNNING/awaiting-confirmation rather than being falsely marked SUCCESS. */
  requiresManualCompletion: boolean;
  deploymentReference?: string;
  message: string;
  /** Never a raw provider error blob - see systemVersionService's error handling for how this is kept clean before reaching the UI. */
  errorDetail?: string;
}

export interface DeploymentProvider {
  /** Machine name, e.g. 'manual' | 'cloudflare-pages' | 'github-actions'. */
  readonly name: string;
  /** True when this provider can execute a deployment without human intervention (a real CI/CD-integrated provider); false for the manual/default provider. */
  readonly isAutomated: boolean;
  deploy(target: DeploymentTarget): Promise<DeploymentResult>;
}
