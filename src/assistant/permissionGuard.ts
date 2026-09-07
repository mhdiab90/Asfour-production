/**
 * Permission Guard - enforces the EXISTING granular permission model
 * (src/utils/permissions.ts / src/types/permissions.ts). This does not
 * invent a parallel permission system: it reuses hasPermission() and
 * canAccessPage() exactly as the rest of the application does.
 */
import { AdminUser, NavigationPage } from '../types';
import { hasPermission, canAccessPage } from '../utils/permissions';
import { ToolDefinition, ToolSummary } from './types';
import { listTools } from './tools/registry';

export interface PermissionCheckResult {
  allowed: boolean;
  reasonAr: string;
  reasonEn: string;
}

/**
 * AI Architecture Consolidation - the ONE synthetic-AdminUser builder for
 * every tool that needs canAccessPage() against a ScreenContext, not a real
 * AdminUser (navigationTools.ts and customDashboardTools.ts each carried
 * their own byte-identical copy). Never a parallel permission model - it
 * feeds the exact same canAccessPage()/hasPermission() this file already
 * wraps.
 */
export function syntheticUserFromContext(context: { currentUserId?: string; currentRole?: string; currentPermissions?: any }): AdminUser {
  return {
    uid: context.currentUserId || '',
    email: '',
    username: '',
    role: (context.currentRole as AdminUser['role']) || 'VIEWER',
    active: true,
    permissions: context.currentPermissions,
  } as AdminUser;
}

/**
 * A tool is allowed if the user holds ANY of its requiredPermission keys,
 * OR (for read-only tools tied to a page) can access the equivalent page.
 * SUPER_ADMIN is always allowed, exactly as hasPermission()/canAccessPage()
 * already resolve for every other part of the app.
 */
export function checkToolPermission(
  tool: ToolDefinition,
  user: AdminUser | null | undefined
): PermissionCheckResult {
  if (!user) {
    return {
      allowed: false,
      reasonAr: 'يجب تسجيل الدخول لاستخدام المساعد الذكي.',
      reasonEn: 'You must be signed in to use the assistant.',
    };
  }

  const hasAnyRequiredPermission =
    tool.requiredPermission.length === 0 ||
    tool.requiredPermission.some((key) => hasPermission(user, key));

  const hasPageAccess = tool.requiredPage ? canAccessPage(user, tool.requiredPage as NavigationPage) : true;

  const allowed = hasAnyRequiredPermission && hasPageAccess;

  if (allowed) {
    return { allowed: true, reasonAr: '', reasonEn: '' };
  }

  return {
    allowed: false,
    reasonAr: `لا تملك الصلاحية اللازمة لتنفيذ "${tool.descriptionAr}".`,
    reasonEn: `You do not have permission to perform "${tool.descriptionEn}".`,
  };
}

/**
 * Data-minimization + defense-in-depth: only offer a real AI provider the
 * tools the current user could actually pass checkToolPermission() for.
 * This does NOT replace the per-call permission check in gateway.ts (the
 * model's tool choice is still re-checked before every execution) - it just
 * avoids advertising capabilities the user doesn't have in the first place.
 */
export function listPermittedToolSummaries(user: AdminUser | null | undefined): ToolSummary[] {
  return listTools()
    .filter((tool) => checkToolPermission(tool, user).allowed)
    .map((t) => ({
      toolName: t.toolName,
      descriptionAr: t.descriptionAr,
      descriptionEn: t.descriptionEn,
      commandType: t.commandType,
      parameterSchema: t.parameterSchema,
    }));
}
