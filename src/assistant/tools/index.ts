/**
 * Registers every ASFOUR assistant tool exactly once. Import this module's
 * `ensureToolsRegistered()` before using the registry (the Gateway does this
 * on construction).
 */
import { registerMasterDataTools } from './masterDataTools';
import { registerProductionQueryTools } from './productionQueryTools';
import { registerAnalysisTools } from './analysisTools';
import { registerExportTools } from './exportTools';
import { registerNavigationTools } from './navigationTools';
import { registerStageReportTools } from './stageReportTools';
import { registerDashboardDesignTools } from './dashboardDesignTools';
import { registerCustomDashboardTools } from './customDashboardTools';
import { registerBusinessInsightsTools } from './businessInsightsTools';
import { registerAnalyticsDiscoveryTools } from './analyticsDiscoveryTools';

let registered = false;

export function ensureToolsRegistered(): void {
  if (registered) return;
  registerMasterDataTools();
  registerProductionQueryTools();
  registerAnalysisTools();
  registerExportTools();
  registerNavigationTools();
  registerStageReportTools();
  registerDashboardDesignTools();
  registerCustomDashboardTools();
  registerBusinessInsightsTools();
  registerAnalyticsDiscoveryTools();
  registered = true;
}

export { getTool, listTools, listToolSummaries } from './registry';
