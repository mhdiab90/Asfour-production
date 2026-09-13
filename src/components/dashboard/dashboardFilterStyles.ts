/**
 * The Dashboard filter-panel visual language, in one place.
 *
 * These are the classes the classic Dashboard's filter panel has always used.
 * The Custom Dashboard's Live Control Bar uses the same constants, so the two
 * dashboards share one filter style instead of each carrying its own copy that
 * drifts - the Custom Dashboard used to render a smaller, light, single-row
 * variant that read as a different application.
 *
 * Class names only; no behaviour lives here.
 */

/** The dark filter panel container. */
export const DASHBOARD_FILTER_PANEL = 'bg-slate-900 border border-slate-800 p-3 flex flex-col gap-3';

/** A filter dropdown on the dark panel. */
export const DASHBOARD_FILTER_SELECT = 'bg-slate-800 text-slate-200 border border-slate-700 rounded px-2 py-1.5 text-xs font-bold';

/** The segmented group holding the period presets. */
export const DASHBOARD_PRESET_GROUP = 'flex items-center gap-1 bg-slate-800 p-1 rounded text-xs font-bold';

/** One period preset button inside the group. */
export function dashboardPresetButton(active: boolean): string {
  return `px-2.5 py-1 rounded transition-colors cursor-pointer ${active ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'}`;
}

/** A date / number input on the dark panel (border colour is added by the caller). */
export const DASHBOARD_DATE_INPUT = 'bg-slate-800 text-slate-200 border rounded px-1.5 py-1 text-[11px]';

/** Refresh / Reset style secondary action on the dark panel. */
export const DASHBOARD_PANEL_BUTTON = 'flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded border border-slate-700 transition-colors cursor-pointer';
