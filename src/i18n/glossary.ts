/**
 * Business Terminology Glossary (§30/§31) - the controlled vocabulary for
 * ASFOUR's core factory nouns, so "مكبس" doesn't drift into "Press" on one
 * screen and "Machine"/"Compactor" on another. Each entry's approved
 * English/Arabic pair IS the seed value for the matching ar.ts/en.ts key
 * (or several keys, listed in `keys`) - editing a term here is informational
 * (a glossary reference); the actual live text is still changed through the
 * Translation Manager's per-key override, which is what every `t()` call
 * site actually reads.
 */
export interface GlossaryTerm {
  id: string;
  termAr: string;
  termEn: string;
  context: string;
  contextAr: string;
  notes: string;
  notesAr: string;
  approved: boolean;
  /** ar.ts/en.ts keys this term governs, so a Translation Manager search can jump straight to them. */
  keys: string[];
}

export const TERMINOLOGY_GLOSSARY: GlossaryTerm[] = [
  { id: 'press', termAr: 'مكبس', termEn: 'Press', context: 'Equipment - Stage 1 (Pressing)', contextAr: 'المعدات - المرحلة الأولى (التشكيل والمكابس)', notes: 'Not "Machine" or "Compactor" - always "Press".', notesAr: 'ليست "آلة" أو "كباسة" - دائمًا "مكبس".', approved: true, keys: ['production_press', 'press'] },
  { id: 'rotary_furnace', termAr: 'الفرن الدوار', termEn: 'Rotary Furnace', context: 'Production Stage 2', contextAr: 'المرحلة الإنتاجية الثانية', notes: 'Distinct from "Tunnel Furnace".', notesAr: 'مختلف عن "الفرن النفقي".', approved: true, keys: ['stage_rotary_furnace'] },
  { id: 'chinese_mill', termAr: 'طاحونة صينية', termEn: 'Chinese Mill', context: 'Production Stage 3 - equipment noun', contextAr: 'المرحلة الإنتاجية الثالثة - اسم المعدة', notes: 'Plural in UI: "Chinese Mills".', notesAr: 'الجمع في الواجهة: "طواحين صينية".', approved: true, keys: ['stage_chinese_mills'] },
  { id: 'tunnel_furnace', termAr: 'فرن نفقي', termEn: 'Tunnel Furnace', context: 'Equipment (Sorting/finishing area)', contextAr: 'المعدات (منطقة الفرز والتشطيب)', notes: 'Distinct from "Rotary Furnace".', notesAr: 'مختلف عن "الفرن الدوار".', approved: true, keys: [] },
  { id: 'furnace_car', termAr: 'العربة', termEn: 'Furnace Car', context: 'Equipment - loads product into the furnace', contextAr: 'المعدات - تحمل المنتج داخل الفرن', notes: 'Not "Cart" or "Trolley".', notesAr: 'ليست "عربة يدوية" أو "ترولي".', approved: true, keys: ['production_furnaceCar'] },
  { id: 'shift', termAr: 'وردية', termEn: 'Shift', context: 'Production scheduling (Shifts 1, 2, 3)', contextAr: 'جدولة الإنتاج (الورديات 1، 2، 3)', notes: 'Always "Shift", never "Session" or "Round".', notesAr: 'دائمًا "وردية"، وليست "جلسة" أو "دورة".', approved: true, keys: ['production_shift'] },
  { id: 'waste', termAr: 'الهالك', termEn: 'Waste', context: 'Production quality metric', contextAr: 'مقياس جودة الإنتاج', notes: 'Not "Scrap" or "Rejects" in system UI (those may appear in raw imported data only).', notesAr: 'ليست "خردة" أو "مرفوض" في واجهة النظام (قد تظهر فقط في بيانات الاستيراد الخام).', approved: true, keys: ['production_waste'] },
  { id: 'good_production', termAr: 'الإنتاج السليم', termEn: 'Good Production', context: 'Production quality metric', contextAr: 'مقياس جودة الإنتاج', notes: 'Not "Valid Production" or "OK Production".', notesAr: 'ليست "إنتاج صحيح" أو "إنتاج جيد فقط".', approved: true, keys: [] },
  { id: 'brick_count', termAr: 'عدد الطوب', termEn: 'Brick Count', context: 'Furnace Car loading detail', contextAr: 'تفاصيل تحميل عربة الفرن', notes: 'Not "Tile Count" or "Block Count".', notesAr: 'ليست "عدد البلاط" أو "عدد الكتل".', approved: true, keys: ['production_brickCount'] },
  { id: 'historical_import', termAr: 'الاستيراد التاريخي', termEn: 'Historical Import', context: 'Bulk Excel import of past production data', contextAr: 'استيراد بيانات إنتاج سابقة من إكسيل بالجملة', notes: 'Not "Legacy Import" or "Bulk Import" (that term is reserved for master data bulk-add).', notesAr: 'ليست "استيراد قديم"، ومصطلح "استيراد بالجملة" محجوز لإضافة البيانات الأساسية.', approved: true, keys: ['nav_historical_import'] },
  { id: 'downtime', termAr: 'التوقف', termEn: 'Downtime', context: 'Equipment fault/stoppage duration', contextAr: 'مدة توقف/عطل المعدة', notes: 'Not "Stoppage" or "Outage" in KPI labels.', notesAr: 'ليست "إيقاف" أو "انقطاع" في تسميات المؤشرات.', approved: true, keys: [] },
  { id: 'raw_materials', termAr: 'الخامات والمواد الأولية', termEn: 'Raw Materials', context: 'Inventory/stock module', contextAr: 'وحدة المخزون', notes: 'Full page title: "Raw Materials & Stock Management".', notesAr: 'عنوان الصفحة الكامل: "إدارة الخامات والمواد الأولية والمخزون".', approved: true, keys: [] },
  { id: 'master_data', termAr: 'البيانات الأساسية', termEn: 'Master Data', context: 'Reference data module (employees, products, presses, etc.)', contextAr: 'وحدة البيانات المرجعية (الموظفون، المنتجات، المكابس، إلخ)', notes: 'Also referred to as "Factory Master Data" on the page header.', notesAr: 'يُشار إليها أيضًا بـ "البيانات الأساسية للمصنع" في رأس الصفحة.', approved: true, keys: ['nav_master_data'] },
];

export function getGlossaryTerm(id: string): GlossaryTerm | undefined {
  return TERMINOLOGY_GLOSSARY.find((t) => t.id === id);
}
