/**
 * A tiny decoupling bridge so the navigateToPage tool (which only receives
 * plain ScreenContext data, never React callbacks) can request a page change
 * without the Tool Registry depending on React. The GlobalAssistant UI
 * component registers the app's real, permission-enforcing onNavigate
 * handler (App.tsx's handleNavigate) here on mount.
 */
import { NavigationPage } from '../types';

let activeNavigateHandler: ((page: NavigationPage) => void) | null = null;

export function setNavigationHandler(handler: (page: NavigationPage) => void): void {
  activeNavigateHandler = handler;
}

export function clearNavigationHandler(): void {
  activeNavigateHandler = null;
}

export function requestNavigation(page: NavigationPage): boolean {
  if (!activeNavigateHandler) return false;
  activeNavigateHandler(page);
  return true;
}
