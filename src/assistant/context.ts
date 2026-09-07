/**
 * Builds the structured, minimal ScreenContext sent to the AI provider.
 * Deliberately never includes the database, full record lists, or anything
 * beyond identifiers/labels for what's currently on screen.
 */
import { AdminUser, NavigationPage } from '../types';
import { resolveUserPermissions } from '../utils/permissions';
import { ScreenContext } from './types';

export interface BuildContextInput {
  currentPage: NavigationPage;
  adminUser: AdminUser | null | undefined;
  language: 'ar' | 'en';
  currentStage?: string;
  selectedRecordId?: string;
  selectedEntityType?: string;
  selectedFilters?: Record<string, any>;
  selectedDateRange?: { startDate?: string; endDate?: string };
}

const PAGE_MODULE_MAP: Partial<Record<NavigationPage, string>> = {
  'dashboard': 'dashboard',
  'production': 'production',
  'production-entry': 'production',
  'production-records': 'production',
  'data-review': 'production',
  'historical-import': 'historicalImport',
  'raw-materials': 'materials',
  'ai-assistant': 'aiAssistant',
  'material-traceability': 'materials',
  'data-quality': 'masterData',
  'master-data': 'masterData',
  'bulk-entry': 'production',
  'reports': 'reports',
  'backup-restore': 'backup',
  'backups': 'backup',
  'restore': 'backup',
  'system-health': 'system',
  'versions': 'system',
  'settings': 'settings',
  'branding': 'settings',
  'user-management': 'userManagement',
  'admin-panel': 'settings',
  'translation-manager': 'translation',
  'language-audit': 'translation',
  // §17 - the Admin AI Provider Manager screen's context must be valid, not
  // just fall back to the raw page id.
  'ai-provider-management': 'AI Provider Management',
};

export function buildScreenContext(input: BuildContextInput): ScreenContext {
  const permissions = input.adminUser ? resolveUserPermissions(input.adminUser) : undefined;

  return {
    currentPage: input.currentPage,
    currentModule: PAGE_MODULE_MAP[input.currentPage] || input.currentPage,
    currentStage: input.currentStage,
    currentUserId: input.adminUser?.uid,
    currentEmployeeId: input.adminUser?.employeeId,
    currentRole: input.adminUser?.role,
    currentPermissions: permissions,
    currentLanguage: input.language,
    selectedRecordId: input.selectedRecordId,
    selectedEntityType: input.selectedEntityType,
    selectedFilters: input.selectedFilters,
    selectedDateRange: input.selectedDateRange,
  };
}
