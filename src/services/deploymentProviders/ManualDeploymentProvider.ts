/**
 * Default DeploymentProvider (§20/§21).
 *
 * This repository has no secure backend (no Cloudflare Worker, no deployment
 * API) to hold GitHub/Cloudflare credentials safely - and per §19 CRITICAL,
 * this frontend must never hold them itself. So the ONLY honest default
 * implementation is one that does NOT attempt to call any deployment
 * platform: it tells the caller a human must complete the deployment
 * outside the app (via whatever CI/CD/hosting console already deploys this
 * site today), and systemVersionService.ts keeps the rollback in a
 * "RUNNING, awaiting manual completion" state rather than ever marking it
 * SUCCESS on its own say-so.
 *
 * This is the abstraction point (§21) where a real, credentialed
 * `CloudflarePagesProvider` or `GitHubActionsProvider` could later be
 * dropped in - each would call a secure server-side endpoint, never hold
 * the credential in this bundle.
 */
import { DeploymentProvider, DeploymentTarget, DeploymentResult } from './DeploymentProvider';

export class ManualDeploymentProvider implements DeploymentProvider {
  readonly name = 'manual';
  readonly isAutomated = false;

  async deploy(target: DeploymentTarget): Promise<DeploymentResult> {
    return {
      success: false,
      requiresManualCompletion: true,
      message: `Automated deployment is not configured for this environment. Deploy commit ${target.commitSha} (branch: ${target.branch}) to ${target.environment} using your existing CI/CD or hosting console, then confirm completion in the rollback wizard.`,
    };
  }
}

/** The active provider - swap this single line to wire a real automated provider later; nothing else in the app needs to change (§21). */
export const activeDeploymentProvider: DeploymentProvider = new ManualDeploymentProvider();
