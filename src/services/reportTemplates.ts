/**
 * Built-in Report Templates (Part 6 §25). Each template is just a
 * `DashboardLayout` (isReport: true) made of ordinary `WidgetConfig`s from
 * the SAME registry the Dashboard Builder uses - there is no separate
 * "report" engine or a fixed hardcoded layout component. Applying a
 * template hands the user a real, immediately-editable starting point in
 * the same builder canvas (Add/Edit/Move/Resize/Delete/Reorder all work on
 * it exactly like a hand-built dashboard).
 */
import { DashboardLayout, DashboardSection, WidgetConfig } from './dashboardRegistry';

function genId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function widget(partial: Partial<WidgetConfig> & Pick<WidgetConfig, 'widgetType' | 'analysisMode' | 'metric' | 'chartType'>): WidgetConfig {
  return {
    widgetId: genId('wid'),
    timeRangePreset: 'inherit',
    filters: {},
    productionStage: 'inherit',
    limit: 10,
    ...partial,
  };
}

function section(title: string, columns: 1 | 2 | 3 | 4, widgets: WidgetConfig[]): DashboardSection {
  return { sectionId: genId('sec'), title, columns, widgets };
}

export interface ReportTemplateDef {
  id: string;
  nameAr: string;
  nameEn: string;
  descriptionAr: string;
  descriptionEn: string;
  printOrientation: 'portrait' | 'landscape';
  build: () => Omit<DashboardLayout, 'dashboardId' | 'dashboardNumber' | 'createdAt' | 'updatedAt'>;
}

export const REPORT_TEMPLATES: ReportTemplateDef[] = [
  {
    id: 'production_performance',
    nameAr: 'أداء الإنتاج', nameEn: 'Production Performance',
    descriptionAr: 'إجمالي الإنتاج والإنتاج السليم والهالك وأفضل المنتجات.',
    descriptionEn: 'Total production, good production, waste, and top products.',
    printOrientation: 'portrait',
    build: () => ({
      name: 'Production Performance', isReport: true, printOrientation: 'portrait',
      sections: [
        section('Executive Summary', 4, [
          widget({ widgetType: 'KPI_CARD', analysisMode: 'SINGLE_METRIC', metric: 'PRODUCTION_TONS', chartType: 'KPI', size: 'SMALL' }),
          widget({ widgetType: 'KPI_CARD', analysisMode: 'SINGLE_METRIC', metric: 'GOOD_TONS', chartType: 'KPI', size: 'SMALL' }),
          widget({ widgetType: 'KPI_CARD', analysisMode: 'SINGLE_METRIC', metric: 'WASTE_RATE', chartType: 'KPI', size: 'SMALL' }),
          widget({ widgetType: 'KPI_CARD', analysisMode: 'SINGLE_METRIC', metric: 'EFFICIENCY_RATE', chartType: 'KPI', size: 'SMALL' }),
        ]),
        section('Production', 2, [
          widget({ widgetType: 'CHART', analysisMode: 'TREND', metric: 'PRODUCTION_TONS', chartType: 'LINE', size: 'MEDIUM' }),
          widget({ widgetType: 'RANKING', analysisMode: 'RANKING', metric: 'PRODUCTION_TONS', entityType: 'PRODUCT', rankingDirection: 'best', chartType: 'HORIZONTAL_BAR', size: 'MEDIUM' }),
        ]),
      ],
    }),
  },
  {
    id: 'equipment_performance',
    nameAr: 'أداء المعدات', nameEn: 'Equipment Performance',
    descriptionAr: 'أفضل وأسوأ المكابس/المعدات من حيث الإنتاج والكفاءة والتوقف.',
    descriptionEn: 'Best/worst equipment by production, efficiency, and downtime.',
    printOrientation: 'landscape',
    build: () => ({
      name: 'Equipment Performance', isReport: true, printOrientation: 'landscape',
      sections: [
        section('Equipment Ranking', 2, [
          widget({ widgetType: 'RANKING', analysisMode: 'RANKING', metric: 'PRODUCTION_TONS', entityType: 'EQUIPMENT', rankingDirection: 'best', limit: 5, chartType: 'HORIZONTAL_BAR', customTitle: undefined, size: 'MEDIUM' }),
          widget({ widgetType: 'RANKING', analysisMode: 'RANKING', metric: 'DOWNTIME_MINUTES', entityType: 'EQUIPMENT', rankingDirection: 'worst', limit: 5, chartType: 'HORIZONTAL_BAR', size: 'MEDIUM' }),
        ]),
        section('Equipment Detail', 1, [
          widget({ widgetType: 'TABLE', analysisMode: 'SINGLE_METRIC', metric: 'EFFICIENCY_RATE', entityType: 'EQUIPMENT', chartType: 'TABLE', limit: 20, size: 'LARGE' }),
        ]),
      ],
    }),
  },
  {
    id: 'employee_performance',
    nameAr: 'أداء الموظفين', nameEn: 'Employee Performance',
    descriptionAr: 'أفضل وأسوأ الموظفين من حيث الإنتاج السليم ونسبة الهالك.',
    descriptionEn: 'Best/worst employees by good production and waste rate.',
    printOrientation: 'portrait',
    build: () => ({
      name: 'Employee Performance', isReport: true, printOrientation: 'portrait',
      sections: [
        section('Employee Ranking', 2, [
          widget({ widgetType: 'RANKING', analysisMode: 'RANKING', metric: 'GOOD_TONS', entityType: 'EMPLOYEE', rankingDirection: 'best', limit: 5, chartType: 'HORIZONTAL_BAR', size: 'MEDIUM' }),
          widget({ widgetType: 'RANKING', analysisMode: 'RANKING', metric: 'WASTE_RATE', entityType: 'EMPLOYEE', rankingDirection: 'worst', limit: 5, chartType: 'HORIZONTAL_BAR', size: 'MEDIUM' }),
        ]),
      ],
    }),
  },
  {
    id: 'shift_performance',
    nameAr: 'أداء الورديات', nameEn: 'Shift Performance',
    descriptionAr: 'مقارنة الورديات الثلاث من حيث الإنتاج والهالك والتوقف.',
    descriptionEn: 'Comparing all three shifts by production, waste, and downtime.',
    printOrientation: 'portrait',
    build: () => ({
      name: 'Shift Performance', isReport: true, printOrientation: 'portrait',
      sections: [
        section('Shift Comparison', 3, [
          widget({ widgetType: 'CHART', analysisMode: 'COMPARISON', metric: 'PRODUCTION_TONS', entityType: 'SHIFT', chartType: 'GROUPED_BAR', size: 'MEDIUM' }),
          widget({ widgetType: 'CHART', analysisMode: 'COMPARISON', metric: 'WASTE_RATE', entityType: 'SHIFT', chartType: 'GROUPED_BAR', size: 'MEDIUM' }),
          widget({ widgetType: 'CHART', analysisMode: 'COMPARISON', metric: 'DOWNTIME_MINUTES', entityType: 'SHIFT', chartType: 'GROUPED_BAR', size: 'MEDIUM' }),
        ]),
      ],
    }),
  },
  {
    id: 'waste_analysis',
    nameAr: 'تحليل الهالك', nameEn: 'Waste Analysis',
    descriptionAr: 'نسب وكميات الهالك مجمعة حسب المنتج والمعدة.',
    descriptionEn: 'Waste quantities and rates grouped by product and equipment.',
    printOrientation: 'portrait',
    build: () => ({
      name: 'Waste Analysis', isReport: true, printOrientation: 'portrait',
      sections: [
        section('Waste Composition', 2, [
          widget({ widgetType: 'CHART', analysisMode: 'SINGLE_METRIC', metric: 'WASTE_TONS', entityType: 'PRODUCT', chartType: 'DONUT', limit: 6, size: 'MEDIUM' }),
          widget({ widgetType: 'RANKING', analysisMode: 'RANKING', metric: 'WASTE_RATE', entityType: 'EQUIPMENT', rankingDirection: 'worst', limit: 5, chartType: 'HORIZONTAL_BAR', size: 'MEDIUM' }),
        ]),
      ],
    }),
  },
  {
    id: 'downtime_analysis',
    nameAr: 'تحليل التوقفات', nameEn: 'Downtime Analysis',
    descriptionAr: 'أوقات التوقف مجمعة حسب المرحلة والمعدة.',
    descriptionEn: 'Downtime minutes grouped by production stage and equipment.',
    printOrientation: 'portrait',
    build: () => ({
      name: 'Downtime Analysis', isReport: true, printOrientation: 'portrait',
      sections: [
        section('Downtime', 2, [
          widget({ widgetType: 'CHART', analysisMode: 'SINGLE_METRIC', metric: 'DOWNTIME_MINUTES', entityType: 'STAGE', chartType: 'DONUT', size: 'MEDIUM' }),
          widget({ widgetType: 'RANKING', analysisMode: 'RANKING', metric: 'DOWNTIME_MINUTES', entityType: 'EQUIPMENT', rankingDirection: 'worst', limit: 5, chartType: 'HORIZONTAL_BAR', size: 'MEDIUM' }),
        ]),
      ],
    }),
  },
  {
    id: 'executive_management',
    nameAr: 'تقرير الإدارة التنفيذية', nameEn: 'Executive Management Report',
    descriptionAr: 'ملخص شامل: الإنتاج، الكفاءة، أفضل/أسوأ الأداء، والهالك والتوقف.',
    descriptionEn: 'A comprehensive summary: production, efficiency, best/worst performers, waste, and downtime.',
    printOrientation: 'landscape',
    build: () => ({
      name: 'Executive Management Report', isReport: true, printOrientation: 'landscape',
      sections: [
        section('Executive Summary', 4, [
          widget({ widgetType: 'KPI_CARD', analysisMode: 'SINGLE_METRIC', metric: 'PRODUCTION_TONS', chartType: 'KPI', size: 'SMALL' }),
          widget({ widgetType: 'KPI_CARD', analysisMode: 'SINGLE_METRIC', metric: 'GOOD_TONS', chartType: 'KPI', size: 'SMALL' }),
          widget({ widgetType: 'KPI_CARD', analysisMode: 'SINGLE_METRIC', metric: 'WASTE_RATE', chartType: 'KPI', size: 'SMALL' }),
          widget({ widgetType: 'KPI_CARD', analysisMode: 'SINGLE_METRIC', metric: 'EFFICIENCY_RATE', chartType: 'KPI', size: 'SMALL' }),
        ]),
        section('Trend', 1, [
          widget({ widgetType: 'CHART', analysisMode: 'TREND', metric: 'PRODUCTION_TONS', chartType: 'LINE', size: 'LARGE' }),
        ]),
        section('Rankings', 3, [
          widget({ widgetType: 'RANKING', analysisMode: 'RANKING', metric: 'PRODUCTION_TONS', entityType: 'EMPLOYEE', rankingDirection: 'best', limit: 5, chartType: 'HORIZONTAL_BAR', customTitle: 'Best Employees', size: 'MEDIUM' }),
          widget({ widgetType: 'RANKING', analysisMode: 'RANKING', metric: 'PRODUCTION_TONS', entityType: 'EQUIPMENT', rankingDirection: 'best', limit: 5, chartType: 'HORIZONTAL_BAR', customTitle: 'Best Equipment', size: 'MEDIUM' }),
          widget({ widgetType: 'RANKING', analysisMode: 'RANKING', metric: 'WASTE_RATE', entityType: 'EQUIPMENT', rankingDirection: 'worst', limit: 5, chartType: 'HORIZONTAL_BAR', customTitle: 'Highest Waste Equipment', size: 'MEDIUM' }),
        ]),
        section('Stage Comparison', 1, [
          widget({ widgetType: 'CHART', analysisMode: 'SINGLE_METRIC', metric: 'PRODUCTION_TONS', entityType: 'STAGE', chartType: 'BAR', size: 'LARGE' }),
        ]),
      ],
    }),
  },
  {
    id: 'daily_report',
    nameAr: 'تقرير يومي', nameEn: 'Daily Report',
    descriptionAr: 'ملخص إنتاج اليوم الحالي.',
    descriptionEn: 'A summary of today\'s production.',
    printOrientation: 'portrait',
    build: () => ({
      name: 'Daily Report', isReport: true, printOrientation: 'portrait',
      sections: [
        section('Today', 3, [
          widget({ widgetType: 'KPI_CARD', analysisMode: 'SINGLE_METRIC', metric: 'PRODUCTION_TONS', chartType: 'KPI', timeRangePreset: 'TODAY', size: 'SMALL' }),
          widget({ widgetType: 'KPI_CARD', analysisMode: 'SINGLE_METRIC', metric: 'WASTE_RATE', chartType: 'KPI', timeRangePreset: 'TODAY', size: 'SMALL' }),
          widget({ widgetType: 'KPI_CARD', analysisMode: 'SINGLE_METRIC', metric: 'DOWNTIME_MINUTES', chartType: 'KPI', timeRangePreset: 'TODAY', size: 'SMALL' }),
        ]),
        section('Detail', 1, [
          widget({ widgetType: 'TABLE', analysisMode: 'SINGLE_METRIC', metric: 'PRODUCTION_TONS', entityType: 'EQUIPMENT', chartType: 'TABLE', timeRangePreset: 'TODAY', size: 'LARGE' }),
        ]),
      ],
    }),
  },
  {
    id: 'weekly_report',
    nameAr: 'تقرير أسبوعي', nameEn: 'Weekly Report',
    descriptionAr: 'ملخص إنتاج آخر 7 أيام.',
    descriptionEn: 'A summary of the last 7 days\' production.',
    printOrientation: 'portrait',
    build: () => ({
      name: 'Weekly Report', isReport: true, printOrientation: 'portrait',
      sections: [
        section('This Week', 3, [
          widget({ widgetType: 'KPI_CARD', analysisMode: 'SINGLE_METRIC', metric: 'PRODUCTION_TONS', chartType: 'KPI', timeRangePreset: 'LAST_7_DAYS', size: 'SMALL' }),
          widget({ widgetType: 'KPI_CARD', analysisMode: 'SINGLE_METRIC', metric: 'WASTE_RATE', chartType: 'KPI', timeRangePreset: 'LAST_7_DAYS', size: 'SMALL' }),
          widget({ widgetType: 'KPI_CARD', analysisMode: 'SINGLE_METRIC', metric: 'DOWNTIME_MINUTES', chartType: 'KPI', timeRangePreset: 'LAST_7_DAYS', size: 'SMALL' }),
        ]),
        section('Trend', 1, [
          widget({ widgetType: 'CHART', analysisMode: 'TREND', metric: 'PRODUCTION_TONS', chartType: 'LINE', timeRangePreset: 'LAST_7_DAYS', size: 'LARGE' }),
        ]),
      ],
    }),
  },
  {
    id: 'monthly_report',
    nameAr: 'تقرير شهري', nameEn: 'Monthly Report',
    descriptionAr: 'ملخص إنتاج الشهر الحالي.',
    descriptionEn: 'A summary of this month\'s production.',
    printOrientation: 'portrait',
    build: () => ({
      name: 'Monthly Report', isReport: true, printOrientation: 'portrait',
      sections: [
        section('This Month', 4, [
          widget({ widgetType: 'KPI_CARD', analysisMode: 'SINGLE_METRIC', metric: 'PRODUCTION_TONS', chartType: 'KPI', timeRangePreset: 'THIS_MONTH', size: 'SMALL' }),
          widget({ widgetType: 'KPI_CARD', analysisMode: 'SINGLE_METRIC', metric: 'GOOD_TONS', chartType: 'KPI', timeRangePreset: 'THIS_MONTH', size: 'SMALL' }),
          widget({ widgetType: 'KPI_CARD', analysisMode: 'SINGLE_METRIC', metric: 'WASTE_RATE', chartType: 'KPI', timeRangePreset: 'THIS_MONTH', size: 'SMALL' }),
          widget({ widgetType: 'KPI_CARD', analysisMode: 'SINGLE_METRIC', metric: 'EFFICIENCY_RATE', chartType: 'KPI', timeRangePreset: 'THIS_MONTH', size: 'SMALL' }),
        ]),
        section('Trend & Ranking', 2, [
          widget({ widgetType: 'CHART', analysisMode: 'TREND', metric: 'PRODUCTION_TONS', chartType: 'LINE', timeRangePreset: 'THIS_MONTH', size: 'MEDIUM' }),
          widget({ widgetType: 'RANKING', analysisMode: 'RANKING', metric: 'PRODUCTION_TONS', entityType: 'PRODUCT', rankingDirection: 'best', timeRangePreset: 'THIS_MONTH', chartType: 'HORIZONTAL_BAR', size: 'MEDIUM' }),
        ]),
      ],
    }),
  },
  {
    id: 'stage_comparison',
    nameAr: 'مقارنة المراحل', nameEn: 'Stage Comparison',
    descriptionAr: 'مقارنة الإنتاج والهالك والتوقف بين كل مراحل التصنيع.',
    descriptionEn: 'Comparing production, waste, and downtime across every manufacturing stage.',
    printOrientation: 'landscape',
    build: () => ({
      name: 'Stage Comparison', isReport: true, printOrientation: 'landscape',
      sections: [
        section('Stages', 3, [
          widget({ widgetType: 'CHART', analysisMode: 'SINGLE_METRIC', metric: 'PRODUCTION_TONS', entityType: 'STAGE', chartType: 'BAR', size: 'MEDIUM' }),
          widget({ widgetType: 'CHART', analysisMode: 'SINGLE_METRIC', metric: 'WASTE_RATE', entityType: 'STAGE', chartType: 'BAR', size: 'MEDIUM' }),
          widget({ widgetType: 'CHART', analysisMode: 'SINGLE_METRIC', metric: 'DOWNTIME_MINUTES', entityType: 'STAGE', chartType: 'BAR', size: 'MEDIUM' }),
        ]),
      ],
    }),
  },
  {
    id: 'best_worst_ranking',
    nameAr: 'ترتيب الأفضل/الأسوأ', nameEn: 'Best/Worst Ranking',
    descriptionAr: 'أفضل وأسوأ الموظفين والمعدات والمنتجات دفعة واحدة.',
    descriptionEn: 'Best/worst employees, equipment, and products in one view.',
    printOrientation: 'landscape',
    build: () => ({
      name: 'Best/Worst Ranking', isReport: true, printOrientation: 'landscape',
      sections: [
        section('Best', 3, [
          widget({ widgetType: 'RANKING', analysisMode: 'RANKING', metric: 'GOOD_TONS', entityType: 'EMPLOYEE', rankingDirection: 'best', limit: 5, chartType: 'HORIZONTAL_BAR', customTitle: 'Best Employees', size: 'MEDIUM' }),
          widget({ widgetType: 'RANKING', analysisMode: 'RANKING', metric: 'PRODUCTION_TONS', entityType: 'EQUIPMENT', rankingDirection: 'best', limit: 5, chartType: 'HORIZONTAL_BAR', customTitle: 'Best Equipment', size: 'MEDIUM' }),
          widget({ widgetType: 'RANKING', analysisMode: 'RANKING', metric: 'PRODUCTION_TONS', entityType: 'PRODUCT', rankingDirection: 'best', limit: 5, chartType: 'HORIZONTAL_BAR', customTitle: 'Best Products', size: 'MEDIUM' }),
        ]),
        section('Worst', 3, [
          widget({ widgetType: 'RANKING', analysisMode: 'RANKING', metric: 'WASTE_RATE', entityType: 'EMPLOYEE', rankingDirection: 'worst', limit: 5, chartType: 'HORIZONTAL_BAR', customTitle: 'Worst Employees (by Waste)', size: 'MEDIUM' }),
          widget({ widgetType: 'RANKING', analysisMode: 'RANKING', metric: 'DOWNTIME_MINUTES', entityType: 'EQUIPMENT', rankingDirection: 'worst', limit: 5, chartType: 'HORIZONTAL_BAR', customTitle: 'Worst Equipment (by Downtime)', size: 'MEDIUM' }),
          widget({ widgetType: 'RANKING', analysisMode: 'RANKING', metric: 'WASTE_RATE', entityType: 'PRODUCT', rankingDirection: 'worst', limit: 5, chartType: 'HORIZONTAL_BAR', customTitle: 'Worst Products (by Waste)', size: 'MEDIUM' }),
        ]),
      ],
    }),
  },
];

export function getReportTemplate(id: string): ReportTemplateDef | undefined {
  return REPORT_TEMPLATES.find((t) => t.id === id);
}
