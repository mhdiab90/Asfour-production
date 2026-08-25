/**
 * ASFOUR Factory Management ERP - Historical Data Import Center
 * 
 * Specialized Historical Excel Importer:
 * - Full support for مرحلة التشكيل والمكابس (Pressing) with 21 strict columns.
 * - Smart Fuzzy Matching with Human Review & Interactive Decision Matrix.
 * - Deep validation: Multi-worker resolution, multi-furnace car splitting,
 *   press & shift (1/2) resolution, smart vs manual product code intelligence,
 *   fault summation breakdown verification, in-file & database duplicate checks.
 * - Pre-import safety: One-click Firestore Backup generation.
 * - Granular preview with multi-status filtering & diagnostics.
 * - Safe chunked batch commits (400 per batch), approved mappings persistence, and batch rollback.
 */
import React, { useState, useEffect } from 'react';
import { 
  FileSpreadsheet, 
  UploadCloud, 
  Download, 
  CheckCircle2, 
  AlertTriangle, 
  AlertCircle, 
  FileText, 
  Loader2, 
  Database,
  RefreshCw,
  ShieldCheck,
  Users,
  Layers,
  Sparkles,
  Info,
  Copy,
  SlidersHorizontal,
  ChevronDown,
  Check,
  X,
  History,
  RotateCcw,
  CheckCheck,
  Search,
  Plus,
  ShieldAlert,
  CheckCircle,
  Ban
} from 'lucide-react';
import { 
  ProductionStageType, 
  PressingImportSummary, 
  PressingImportRow, 
  PressingImportStatus 
} from '../../types';
import { 
  downloadStageExcelTemplate, 
  downloadPressingExcelTemplate,
  parseAndValidatePressingExcel,
  executePressingBatchImport,
  parseExcelFile, 
  validateImportRows, 
  executeBatchImport,
  StageImportRow,
  ImportValidationResult
} from '../../services/historicalImportService';
import { STAGE_DISPLAY_NAMES } from '../../services/stageRecordService';
import { createDatabaseBackup } from '../../services/backupService';
import { 
  getHistoricalImportHistory, 
  rollbackImportBatch, 
  saveApprovedMappingBatch,
  ImportAuditEntry 
} from '../../services/importMappingService';
import { fetchMasterData } from '../../services/masterDataService';
import { Badge } from '../common/Badge';
import { Modal } from '../common/Modal';
import { formatNumber, formatDecimal, formatDateTime } from '../../utils/formatters';
import { useLanguage } from '../../i18n/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import { InlineMasterDataAddModal } from './InlineMasterDataAddModal';

type FilterTab = 'ALL' | 'VALID' | 'MATCHES' | 'WARNINGS' | 'ERRORS' | 'DUPLICATES';

export const DataImportView: React.FC = () => {
  const { language, isRtl } = useLanguage();
  const { adminUser, isSuperAdmin, hasPermission } = useAuth();
  const [selectedStage, setSelectedStage] = useState<ProductionStageType>('pressing');
  const [file, setFile] = useState<File | null>(null);
  const [isParsing, setIsParsing] = useState<boolean>(false);
  
  // Pressing Stage Dedicated State
  const [pressingSummary, setPressingSummary] = useState<PressingImportSummary | null>(null);
  const [activeFilterTab, setActiveFilterTab] = useState<FilterTab>('ALL');

  // Inline Master Data Quick Add Modal State
  const [addedMasterDataCount, setAddedMasterDataCount] = useState<number>(0);
  const [existingMasterDataList, setExistingMasterDataList] = useState<any[]>([]);
  const [inlineAddModalState, setInlineAddModalState] = useState<{
    isOpen: boolean;
    domain: string;
    importedValue: string;
    targetRowIndex?: number;
    extraContext?: any;
  }>({
    isOpen: false,
    domain: 'product',
    importedValue: '',
  });

  // Preload master data items for duplicate validation
  useEffect(() => {
    const loadMasterDataForChecker = async () => {
      try {
        const [emps, presses, prods, cars] = await Promise.all([
          fetchMasterData('employees').catch(() => []),
          fetchMasterData('presses').catch(() => []),
          fetchMasterData('products').catch(() => []),
          fetchMasterData('furnaceCars').catch(() => []),
        ]);
        setExistingMasterDataList([...emps, ...presses, ...prods, ...cars]);
      } catch (err) {
        console.warn('Failed to preload master data for duplicate checker:', err);
      }
    };
    loadMasterDataForChecker();
  }, []);

  // Granular Permission Check for Inline Master Data Creation
  const canAddMasterData = React.useMemo(() => {
    if (isSuperAdmin) return true;
    if (!adminUser) return false;
    if (adminUser.role === 'SUPER_ADMIN' || adminUser.role === 'ADMIN') return true;
    const perms = adminUser.permissions as Record<string, any> | undefined;
    if (perms?.['masterData.inlineAdd'] === true) return true;
    if (perms?.masterDataCreate === true) return true;
    if (perms?.['masterdata.view'] === true) return true;
    return false;
  }, [adminUser, isSuperAdmin]);
  
  // Generic Stage Fallback State (for other 7 stages)
  const [genericRawRows, setGenericRawRows] = useState<StageImportRow[]>([]);
  const [genericValidation, setGenericValidation] = useState<ImportValidationResult | null>(null);
  const [autoCreateMasterData, setAutoCreateMasterData] = useState<boolean>(true);

  // Import Execution & Safety
  const [isCreatingBackup, setIsCreatingBackup] = useState<boolean>(false);
  const [backupId, setBackupId] = useState<string | null>(null);
  const [backupStatusMessage, setBackupStatusMessage] = useState<string | null>(null);
  
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [importProgress, setImportProgress] = useState<number>(0);
  const [currentBatchNum, setCurrentBatchNum] = useState<number>(0);
  const [totalBatchCount, setTotalBatchCount] = useState<number>(0);
  const [importResult, setImportResult] = useState<{
    total: number;
    imported: number;
    failed: number;
    skipped: number;
    importId: string;
  } | null>(null);

  // Import History & Rollback State
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState<boolean>(false);
  const [importHistory, setImportHistory] = useState<ImportAuditEntry[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState<boolean>(false);
  const [rollbackTargetBatch, setRollbackTargetBatch] = useState<ImportAuditEntry | null>(null);
  const [isRollingBack, setIsRollingBack] = useState<boolean>(false);
  const [rollbackSuccessMsg, setRollbackSuccessMsg] = useState<string | null>(null);

  // Clear all parsed state when switching stage or uploading new file
  const resetFileState = () => {
    setFile(null);
    setPressingSummary(null);
    setGenericRawRows([]);
    setGenericValidation(null);
    setImportResult(null);
    setImportProgress(0);
    setActiveFilterTab('ALL');
  };

  const handleStageChange = (newStage: ProductionStageType) => {
    setSelectedStage(newStage);
    resetFileState();
  };

  const handleFileDrop = async (e: React.DragEvent | React.ChangeEvent<HTMLInputElement>) => {
    let uploadedFile: File | null = null;
    if ('dataTransfer' in e) {
      e.preventDefault();
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        uploadedFile = e.dataTransfer.files[0];
      }
    } else if (e.target.files && e.target.files[0]) {
      uploadedFile = e.target.files[0];
    }

    if (!uploadedFile) return;
    setFile(uploadedFile);
    setIsParsing(true);
    setImportResult(null);

    try {
      if (selectedStage === 'pressing') {
        const buffer = await uploadedFile.arrayBuffer();
        const summary = await parseAndValidatePressingExcel(buffer);
        setPressingSummary(summary);
        const hasProposedMatches = summary.rows.some(r => r.proposedMatches && r.proposedMatches.length > 0);
        if (hasProposedMatches) {
          setActiveFilterTab('MATCHES');
        }
      } else {
        const rows = await parseExcelFile(uploadedFile);
        setGenericRawRows(rows);
        const valResult = await validateImportRows(selectedStage, rows);
        setGenericValidation(valResult);
      }
    } catch (err: any) {
      console.error('File parsing error:', err);
      alert(language === 'ar' ? 'فشل قراءة ملف الـ Excel: ' + (err.message || 'تأكد من تنسيق الأعطال والبيانات') : 'Failed to parse Excel file: ' + err.message);
    } finally {
      setIsParsing(false);
    }
  };

  // One-click Backup before Import
  const handleCreateSafetyBackup = async () => {
    setIsCreatingBackup(true);
    setBackupStatusMessage(language === 'ar' ? 'جاري توليد نسخة احتياطية وقائية وحفظها...' : 'Generating safety backup snapshot...');
    try {
      const backup = await createDatabaseBackup(
        'PRE_IMPORT',
        `نسخة أمان وقائية قبل استيراد الإنتاج التاريخي لمرحلة ${STAGE_DISPLAY_NAMES[selectedStage]}`,
        (stage, pct) => setBackupStatusMessage(`${stage} (${pct}%)`),
        true
      );
      setBackupId(backup.backupId);
      setBackupStatusMessage(language === 'ar' ? `تم إنشاء النسخة الوقائية بنجاح (${backup.backupId}) وتنزيل الملف.` : `Safety backup created (${backup.backupId}).`);
    } catch (err: any) {
      console.error('Backup creation error:', err);
      setBackupStatusMessage((language === 'ar' ? 'تعذر إنشاء النسخة الاحتياطية تلقائياً: ' : 'Failed to create backup: ') + err.message);
    } finally {
      setIsCreatingBackup(false);
    }
  };

  // Open Inline Master Data Quick Add Modal
  const handleOpenInlineAdd = (
    domain: string,
    importedValue: string,
    targetRowIndex?: number,
    extraContext?: any
  ) => {
    if (!canAddMasterData) {
      alert(language === 'ar' ? 'ليس لديك صلاحية إضافة بيانات أساسية أثناء الاستيراد (masterData.inlineAdd).' : 'You do not have permission to add master data during import.');
      return;
    }
    setInlineAddModalState({
      isOpen: true,
      domain,
      importedValue,
      targetRowIndex,
      extraContext,
    });
  };

  // Callback when a Master Data record is created via inline modal
  const handleMasterDataCreated = async (createdItem: { id: string; code: string; name: string; [key: string]: any }) => {
    if (!pressingSummary) return;

    setAddedMasterDataCount(prev => prev + 1);
    setExistingMasterDataList(prev => [...prev, createdItem]);

    const domain = inlineAddModalState.domain;
    const targetRowIndex = inlineAddModalState.targetRowIndex;
    const importedVal = (inlineAddModalState.importedValue || '').trim();

    // Persist approved mapping in Firestore for audit & future imports
    if (importedVal) {
      const mappingDomain = (domain === 'worker1' || domain === 'worker2' || domain === 'employee1' || domain === 'employee2') ? 'employee' : domain;
      saveApprovedMappingBatch([{
        domain: mappingDomain,
        originalValue: importedVal,
        mappedEntityId: createdItem.id,
        mappedEntityName: createdItem.name,
        mappedEntityCode: createdItem.code,
        confidence: 100,
        matchType: 'MANUAL_INLINE_ADD',
      }]).catch(err => console.warn('Could not persist mapping:', err));
    }

    const updatedRows = pressingSummary.rows.map((row) => {
      let rowModified = false;
      const updatedRow = { ...row };

      // Worker 1
      if (domain === 'employee' || domain === 'worker1' || domain === 'employee1') {
        const isMatch = (row.worker1Name && row.worker1Name.trim() === importedVal) ||
                        (row.worker1Code && row.worker1Code.trim() === createdItem.code) ||
                        (targetRowIndex !== undefined && row.rowIndex === targetRowIndex && !row.resolvedWorker1);
        if (isMatch) {
          updatedRow.worker1Code = createdItem.code || updatedRow.worker1Code;
          updatedRow.resolvedWorker1 = { id: createdItem.id, name: createdItem.name, code: createdItem.code };
          updatedRow.errors = updatedRow.errors.filter(e => !e.includes('عامل 1'));
          rowModified = true;
        }
      }

      // Worker 2
      if (domain === 'employee' || domain === 'worker2' || domain === 'employee2') {
        const isMatch = (row.worker2Name && row.worker2Name.trim() === importedVal) ||
                        (row.worker2Code && row.worker2Code.trim() === createdItem.code) ||
                        (targetRowIndex !== undefined && row.rowIndex === targetRowIndex && row.worker2Name && !row.resolvedWorker2);
        if (isMatch) {
          updatedRow.worker2Code = createdItem.code || updatedRow.worker2Code;
          updatedRow.resolvedWorker2 = { id: createdItem.id, name: createdItem.name, code: createdItem.code };
          updatedRow.errors = updatedRow.errors.filter(e => !e.includes('عامل 2'));
          rowModified = true;
        }
      }

      // Press
      if (domain === 'press') {
        const isMatch = (row.pressRaw && row.pressRaw.trim() === importedVal) ||
                        (targetRowIndex !== undefined && row.rowIndex === targetRowIndex && !row.resolvedPress);
        if (isMatch) {
          updatedRow.resolvedPress = { id: createdItem.id, name: createdItem.name, code: createdItem.code };
          updatedRow.errors = updatedRow.errors.filter(e => !e.includes('المكبس') && !e.includes('مكبس'));
          rowModified = true;
        }
      }

      // Product
      if (domain === 'product') {
        const isMatch = (row.productCodeRaw && row.productCodeRaw.trim() === importedVal) ||
                        (row.productNameRaw && row.productNameRaw.trim() === importedVal) ||
                        (row.productCodeRaw && row.productCodeRaw.trim() === createdItem.code) ||
                        (targetRowIndex !== undefined && row.rowIndex === targetRowIndex && !row.resolvedProduct);
        if (isMatch) {
          updatedRow.productCodeRaw = createdItem.code || updatedRow.productCodeRaw;
          updatedRow.resolvedProduct = { 
            id: createdItem.id, 
            name: createdItem.name, 
            code: createdItem.code,
            pieceWeight: createdItem.pieceWeight || updatedRow.pieceWeight,
            aluminaPercentage: createdItem.aluminaPercentage || updatedRow.aluminaPercentage,
          };
          updatedRow.errors = updatedRow.errors.filter(e => !e.includes('الصنف') && !e.includes('كود الصنف'));
          rowModified = true;
        }
      }

      // Furnace Car
      if (domain === 'furnaceCar' || domain === 'car') {
        const isMatch = (row.furnaceCarsRaw && row.furnaceCarsRaw.includes(importedVal)) ||
                        (targetRowIndex !== undefined && row.rowIndex === targetRowIndex);
        if (isMatch) {
          const currentCars = updatedRow.resolvedFurnaceCars || [];
          if (!currentCars.some(c => c.id === createdItem.id)) {
            updatedRow.resolvedFurnaceCars = [...currentCars, { id: createdItem.id, code: createdItem.code, carNumber: createdItem.name || createdItem.code }];
          }
          updatedRow.errors = updatedRow.errors.filter(e => !e.includes('عربة') && !e.includes('عربات'));
          rowModified = true;
        }
      }

      // Update proposed match item on row if present
      if (updatedRow.proposedMatches) {
        updatedRow.proposedMatches = updatedRow.proposedMatches.map(pm => {
          if (pm.importedValue === importedVal || (targetRowIndex !== undefined && row.rowIndex === targetRowIndex && pm.fieldDomain === domain)) {
            return {
              ...pm,
              suggestedId: createdItem.id,
              suggestedName: createdItem.name,
              suggestedCode: createdItem.code,
              confidence: 100,
              decision: 'ACCEPTED' as const,
            };
          }
          return pm;
        });
      }

      // Re-evaluate status
      if (rowModified) {
        if (updatedRow.errors.length === 0) {
          updatedRow.status = updatedRow.warnings.length > 0 ? 'WARNING' : 'VALID';
        }
      }

      return updatedRow;
    });

    const validRows = updatedRows.filter(r => r.errors.length === 0 && r.warnings.length === 0 && !r.isDuplicate).length;
    const warningRows = updatedRows.filter(r => r.warnings.length > 0 && r.errors.length === 0).length;
    const errorRows = updatedRows.filter(r => r.errors.length > 0).length;

    setPressingSummary({
      ...pressingSummary,
      rows: updatedRows,
      validRows,
      warningRows,
      errorRows,
    });
  };

  // Accept a proposed match for a specific row and fieldDomain
  const handleAcceptProposedMatch = (
    rowIndex: number, 
    matchIndex: number, 
    chosenCandidate?: { id: string; name: string; code?: string; confidence: number }
  ) => {
    if (!pressingSummary) return;

    const updatedRows = pressingSummary.rows.map((row) => {
      if (row.rowIndex !== rowIndex || !row.proposedMatches) return row;

      const prop = row.proposedMatches[matchIndex];
      if (!prop) return row;

      const candidateToUse = chosenCandidate || {
        id: prop.suggestedId || '',
        name: prop.suggestedName || '',
        code: prop.suggestedCode || '',
        confidence: prop.confidence
      };

      const updatedMatches = [...row.proposedMatches];
      updatedMatches[matchIndex] = {
        ...prop,
        suggestedId: candidateToUse.id,
        suggestedName: candidateToUse.name,
        suggestedCode: candidateToUse.code,
        confidence: candidateToUse.confidence,
        decision: 'ACCEPTED',
      };

      const updatedRow = { ...row, proposedMatches: updatedMatches };

      // Apply resolution to entity
      if (prop.fieldDomain === 'employee1' || prop.fieldDomain === 'worker1') {
        updatedRow.worker1Code = candidateToUse.code || updatedRow.worker1Code;
        updatedRow.resolvedWorker1 = { id: candidateToUse.id, name: candidateToUse.name, code: candidateToUse.code || '' };
        updatedRow.errors = updatedRow.errors.filter(e => !e.includes('عامل 1'));
      } else if (prop.fieldDomain === 'employee2' || prop.fieldDomain === 'worker2') {
        updatedRow.worker2Code = candidateToUse.code || updatedRow.worker2Code;
        updatedRow.resolvedWorker2 = { id: candidateToUse.id, name: candidateToUse.name, code: candidateToUse.code || '' };
        updatedRow.errors = updatedRow.errors.filter(e => !e.includes('عامل 2'));
      } else if (prop.fieldDomain === 'press') {
        updatedRow.resolvedPress = { id: candidateToUse.id, name: candidateToUse.name, code: candidateToUse.code || '' };
        updatedRow.errors = updatedRow.errors.filter(e => !e.includes('المكبس') && !e.includes('مكبس'));
      } else if (prop.fieldDomain === 'product') {
        updatedRow.productCodeRaw = candidateToUse.code || updatedRow.productCodeRaw;
        updatedRow.resolvedProduct = { id: candidateToUse.id, name: candidateToUse.name, code: candidateToUse.code || '' };
        updatedRow.errors = updatedRow.errors.filter(e => !e.includes('الصنف') && !e.includes('كود الصنف'));
      } else if (prop.fieldDomain === 'furnaceCar') {
        updatedRow.resolvedFurnaceCars = [{ id: candidateToUse.id, code: candidateToUse.code || '', carNumber: candidateToUse.name || candidateToUse.code || '' }];
        updatedRow.errors = updatedRow.errors.filter(e => !e.includes('عربة') && !e.includes('عربات'));
      }

      // Re-evaluate row status
      if (updatedRow.errors.length === 0) {
        updatedRow.status = updatedRow.warnings.length > 0 ? 'WARNING' : 'VALID';
      }

      return updatedRow;
    });

    // Recompute stats
    const validRows = updatedRows.filter(r => r.errors.length === 0 && r.warnings.length === 0 && !r.isDuplicate).length;
    const warningRows = updatedRows.filter(r => r.warnings.length > 0 && r.errors.length === 0).length;
    const errorRows = updatedRows.filter(r => r.errors.length > 0).length;

    setPressingSummary({
      ...pressingSummary,
      rows: updatedRows,
      validRows,
      warningRows,
      errorRows,
    });
  };

  // Skip a proposed match (with strict check if field is mandatory)
  const handleSkipProposedMatch = (rowIndex: number, matchIndex: number) => {
    if (!pressingSummary) return;

    const targetRow = pressingSummary.rows.find(r => r.rowIndex === rowIndex);
    const prop = targetRow?.proposedMatches?.[matchIndex];
    if (!prop) return;

    // Check if mandatory
    const isMandatory = prop.fieldDomain === 'worker1' || 
                        prop.fieldDomain === 'employee1' || 
                        prop.fieldDomain === 'press' || 
                        prop.fieldDomain === 'product' || 
                        prop.fieldDomain === 'furnaceCar';

    if (isMandatory) {
      const confirmSkip = window.confirm(
        language === 'ar'
          ? `تنبيه: حقل (${prop.fieldNameAr || prop.fieldDomain}) إلزامي لإتمام الاستيراد.\nتخطي هذا البيان لن يجعل الصف صالحاً، وسيبقى كخطأ مانع للاستيراد حتى يتم اعتماده أو إضافته.\n\nهل تريد تأكيد التخطي؟`
          : `Notice: Field (${prop.fieldDomain}) is required to complete the import.\nSkipping will keep this row as a blocking error until resolved.\n\nDo you want to confirm skipping?`
      );
      if (!confirmSkip) return;
    }

    const updatedRows = pressingSummary.rows.map((row) => {
      if (row.rowIndex !== rowIndex || !row.proposedMatches) return row;

      const updatedMatches = [...row.proposedMatches];
      updatedMatches[matchIndex] = {
        ...prop,
        decision: 'REJECTED',
      };

      const updatedRow = { ...row, proposedMatches: updatedMatches };

      // If non-mandatory worker2, clear warning/error
      if (prop.fieldDomain === 'employee2' || prop.fieldDomain === 'worker2') {
        updatedRow.errors = updatedRow.errors.filter(e => !e.includes('عامل 2'));
        if (updatedRow.errors.length === 0) {
          updatedRow.status = updatedRow.warnings.length > 0 ? 'WARNING' : 'VALID';
        }
      }

      return updatedRow;
    });

    const validRows = updatedRows.filter(r => r.errors.length === 0 && r.warnings.length === 0 && !r.isDuplicate).length;
    const warningRows = updatedRows.filter(r => r.warnings.length > 0 && r.errors.length === 0).length;
    const errorRows = updatedRows.filter(r => r.errors.length > 0).length;

    setPressingSummary({
      ...pressingSummary,
      rows: updatedRows,
      validRows,
      warningRows,
      errorRows,
    });
  };

  // Accept all high-confidence proposed matches (≥ 90%) in one click
  const handleAcceptAllHighConfidence = () => {
    if (!pressingSummary) return;

    const updatedRows = pressingSummary.rows.map((row) => {
      if (!row.proposedMatches || row.proposedMatches.length === 0) return row;

      let updatedRow = { ...row };
      const updatedMatches = row.proposedMatches.map((prop) => {
        if (prop.confidence >= 90 && prop.decision !== 'REJECTED') {
          const candidateToUse = {
            id: prop.suggestedId || '',
            name: prop.suggestedName || '',
            code: prop.suggestedCode || '',
            confidence: prop.confidence
          };
          
          if (prop.fieldDomain === 'employee1' || prop.fieldDomain === 'worker1') {
            updatedRow.worker1Code = candidateToUse.code || updatedRow.worker1Code;
            updatedRow.resolvedWorker1 = { id: candidateToUse.id, name: candidateToUse.name, code: candidateToUse.code };
            updatedRow.errors = updatedRow.errors.filter(e => !e.includes('عامل 1'));
          } else if (prop.fieldDomain === 'employee2' || prop.fieldDomain === 'worker2') {
            updatedRow.worker2Code = candidateToUse.code || updatedRow.worker2Code;
            updatedRow.resolvedWorker2 = { id: candidateToUse.id, name: candidateToUse.name, code: candidateToUse.code };
            updatedRow.errors = updatedRow.errors.filter(e => !e.includes('عامل 2'));
          } else if (prop.fieldDomain === 'press') {
            updatedRow.resolvedPress = { id: candidateToUse.id, name: candidateToUse.name, code: candidateToUse.code };
            updatedRow.errors = updatedRow.errors.filter(e => !e.includes('المكبس') && !e.includes('مكبس'));
          } else if (prop.fieldDomain === 'product') {
            updatedRow.productCodeRaw = candidateToUse.code || updatedRow.productCodeRaw;
            updatedRow.resolvedProduct = { id: candidateToUse.id, name: candidateToUse.name, code: candidateToUse.code };
            updatedRow.errors = updatedRow.errors.filter(e => !e.includes('الصنف') && !e.includes('كود الصنف'));
          } else if (prop.fieldDomain === 'furnaceCar') {
            updatedRow.resolvedFurnaceCars = [{ id: candidateToUse.id, code: candidateToUse.code, carNumber: candidateToUse.name || candidateToUse.code }];
            updatedRow.errors = updatedRow.errors.filter(e => !e.includes('عربة') && !e.includes('عربات'));
          }

          return {
            ...prop,
            decision: 'ACCEPTED' as const,
          };
        }
        return prop;
      });

      updatedRow.proposedMatches = updatedMatches;
      if (updatedRow.errors.length === 0) {
        updatedRow.status = updatedRow.warnings.length > 0 ? 'WARNING' : 'VALID';
      }
      return updatedRow;
    });

    // Recompute stats
    const validRows = updatedRows.filter(r => r.errors.length === 0 && r.warnings.length === 0 && !r.isDuplicate).length;
    const warningRows = updatedRows.filter(r => r.warnings.length > 0 && r.errors.length === 0).length;
    const errorRows = updatedRows.filter(r => r.errors.length > 0).length;

    setPressingSummary({
      ...pressingSummary,
      rows: updatedRows,
      validRows,
      warningRows,
      errorRows,
    });
  };

  // Start Actual Import
  const handleStartImport = async () => {
    if (selectedStage === 'pressing') {
      if (!pressingSummary) return;
      const validAndWarningRows = pressingSummary.rows.filter(r => r.errors.length === 0);
      if (validAndWarningRows.length === 0) {
        alert(language === 'ar' ? 'لا توجد صفوف صالحة للاستيراد. يرجى تصحيح الأخطاء أولاً.' : 'No valid rows to import. Please resolve errors.');
        return;
      }

      setIsImporting(true);
      setImportProgress(0);
      try {
        const result = await executePressingBatchImport(
          validAndWarningRows,
          backupId || undefined,
          (pct, currBatch, totBatches) => {
            setImportProgress(pct);
            setCurrentBatchNum(currBatch);
            setTotalBatchCount(totBatches);
          }
        );

        setImportResult({
          total: pressingSummary.totalRows,
          imported: result.importedCount,
          failed: result.failedCount,
          skipped: result.skippedCount,
          importId: result.importId,
        });
        setPressingSummary(null);
      } catch (err: any) {
        alert(language === 'ar' ? 'حدث خطأ أثناء تنفيذ الاستيراد: ' + (err.message || 'خطأ غير معروف') : 'Import error: ' + err.message);
      } finally {
        setIsImporting(false);
      }
    } else {
      // Generic stages fallback
      if (!genericValidation || genericValidation.validRows.length === 0) return;
      setIsImporting(true);
      setImportProgress(0);
      try {
        const summary = await executeBatchImport(
          selectedStage,
          genericValidation.validRows,
          autoCreateMasterData,
          (progress) => setImportProgress(progress)
        );
        setImportResult({
          total: genericValidation.validRows.length,
          imported: summary.success,
          failed: summary.errors.length,
          skipped: genericValidation.errors.length,
          importId: `IMPORT-${Date.now()}`,
        });
        setGenericRawRows([]);
        setGenericValidation(null);
      } catch (err: any) {
        alert(language === 'ar' ? 'حدث خطأ أثناء الاستيراد: ' + (err.message || 'خطأ غير معروف') : 'Import error: ' + err.message);
      } finally {
        setIsImporting(false);
      }
    }
  };

  // Open Import History Modal
  const openHistoryModal = async () => {
    setIsHistoryModalOpen(true);
    setIsLoadingHistory(true);
    try {
      const history = await getHistoricalImportHistory();
      setImportHistory(history);
    } catch (err) {
      console.warn('Failed to load history:', err);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  // Handle Rollback Batch
  const handleConfirmRollback = async () => {
    if (!rollbackTargetBatch) return;
    setIsRollingBack(true);
    setRollbackSuccessMsg(null);
    try {
      const res = await rollbackImportBatch(rollbackTargetBatch.importBatchId, rollbackTargetBatch.stage);
      setRollbackSuccessMsg(
        language === 'ar'
          ? `تم التراجع بنجاح وحذف ${res.deletedCount} سجل من دفعة (${rollbackTargetBatch.importBatchId}).`
          : `Successfully rolled back ${res.deletedCount} records for batch (${rollbackTargetBatch.importBatchId}).`
      );
      // Refresh history list
      const refreshed = await getHistoricalImportHistory();
      setImportHistory(refreshed);
      setRollbackTargetBatch(null);
    } catch (err: any) {
      alert(language === 'ar' ? 'فشل التراجع عن الدفعة: ' + err.message : 'Rollback failed: ' + err.message);
    } finally {
      setIsRollingBack(false);
    }
  };

  // Filter pressing rows based on active tab
  const getFilteredPressingRows = (): PressingImportRow[] => {
    if (!pressingSummary) return [];
    switch (activeFilterTab) {
      case 'VALID':
        return pressingSummary.rows.filter(r => r.errors.length === 0 && r.warnings.length === 0 && !r.isDuplicate);
      case 'MATCHES':
        return pressingSummary.rows.filter(r => r.proposedMatches && r.proposedMatches.length > 0);
      case 'WARNINGS':
        return pressingSummary.rows.filter(r => r.warnings.length > 0 && r.errors.length === 0);
      case 'ERRORS':
        return pressingSummary.rows.filter(r => r.errors.length > 0);
      case 'DUPLICATES':
        return pressingSummary.rows.filter(r => r.isDuplicate);
      case 'ALL':
      default:
        return pressingSummary.rows;
    }
  };

  const filteredPressingRows = getFilteredPressingRows();

  // Count total proposed matches across all rows
  const totalProposedMatchesCount = pressingSummary?.rows.reduce(
    (acc, r) => acc + (r.proposedMatches?.length || 0), 
    0
  ) || 0;

  // Helper for Status Badge Rendering
  const renderStatusBadge = (row: PressingImportRow) => {
    if (row.errors.length > 0) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-red-100 text-red-800 border border-red-200">
          <AlertCircle className="w-3 h-3 text-red-600" />
          {row.status === 'UNKNOWN_EMPLOYEE' && (language === 'ar' ? 'عامل غير مسجل' : 'Unknown Employee')}
          {row.status === 'EMPLOYEE_MISMATCH' && (language === 'ar' ? 'تعارض كود العامل' : 'Employee Code Mismatch')}
          {row.status === 'UNKNOWN_PRODUCT' && (language === 'ar' ? 'صنف غير مسجل' : 'Unknown Product')}
          {row.status === 'PRODUCT_MISMATCH' && (language === 'ar' ? 'تعارض كود الصنف' : 'Product Code Mismatch')}
          {row.status === 'UNKNOWN_PRESS' && (language === 'ar' ? 'مكبس غير مسجل' : 'Unknown Press')}
          {row.status === 'UNKNOWN_FURNACE_CAR' && (language === 'ar' ? 'عربة غير مسجلة' : 'Unknown Furnace Car')}
          {row.status === 'INVALID_SHIFT' && (language === 'ar' ? 'وردية غير صالحة' : 'Invalid Shift')}
          {row.status === 'INVALID_DATE' && (language === 'ar' ? 'تاريخ غير صالح' : 'Invalid Date')}
          {row.status === 'INVALID_NUMBER' && (language === 'ar' ? 'أرقام غير صالحة' : 'Invalid Number')}
          {row.status === 'DUPLICATE_IN_FILE' && (language === 'ar' ? 'تكرار في الملف' : 'Duplicate in File')}
          {row.status === 'INVALID_ROW' && (language === 'ar' ? 'خطأ بالبيانات' : 'Invalid Row')}
        </span>
      );
    }

    if (row.warnings.length > 0 || row.isDuplicate) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-amber-100 text-amber-900 border border-amber-200">
          <AlertTriangle className="w-3 h-3 text-amber-600" />
          {row.status === 'FAULT_TOTAL_MISMATCH' && (language === 'ar' ? 'فروق أعطال' : 'Fault Mismatch')}
          {row.status === 'MISSING_PIECE_WEIGHT' && (language === 'ar' ? 'وزن مفقود' : 'Missing Weight')}
          {row.status === 'DUPLICATE_IN_DATABASE' && (language === 'ar' ? 'مكرر في النظام' : 'Duplicate in Database')}
          {row.status === 'WARNING' && (language === 'ar' ? 'تنبيه' : 'Warning')}
        </span>
      );
    }

    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
        <CheckCircle2 className="w-3 h-3 text-emerald-600" />
        {language === 'ar' ? 'جاهز' : 'Valid'}
      </span>
    );
  };

  return (
    <div className="space-y-6" dir={isRtl ? 'rtl' : 'ltr'}>
      {/* Header Bar */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-black text-slate-900 flex items-center gap-2">
            <FileSpreadsheet className="w-6 h-6 text-emerald-600" />
            <span>{language === 'ar' ? 'مركز استيراد بيانات الإنتاج التاريخي' : 'Historical Production Data Import'}</span>
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            {language === 'ar' 
              ? 'استيراد السجلات السابقة عبر ملفات Excel الرسمية مع المطابقة الذكية للبيانات الأساسية وتدقيق الأعطال'
              : 'Import historical production records with smart AI-assisted fuzzy entity matching and complete audit rollback.'}
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={openHistoryModal}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
          >
            <History className="w-4 h-4 text-slate-600" />
            <span>{language === 'ar' ? 'سجل العمليات والتراجع' : 'Import History & Rollback'}</span>
          </button>

          <button
            type="button"
            onClick={() => downloadStageExcelTemplate(selectedStage)}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl shadow-xs transition-colors cursor-pointer"
          >
            <Download className="w-4 h-4" />
            <span>{language === 'ar' ? `تحميل قالب Excel الرسمي (${STAGE_DISPLAY_NAMES[selectedStage]})` : `Download Template (${STAGE_DISPLAY_NAMES[selectedStage]})`}</span>
          </button>
        </div>
      </div>

      {/* Stage Selector Tabs */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-3">
        <div className="flex items-center justify-between">
          <label className="block text-xs font-bold text-slate-700">
            {language === 'ar' ? 'اختر المرحلة الإنتاجية المراد استيراد بياناتها:' : 'Select Production Stage:'}
          </label>
          {selectedStage === 'pressing' && (
            <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-emerald-600" />
              {language === 'ar' ? 'تنسيق المكابس المتقدم (21 عمود معتمد + مطابقة ذكية)' : 'Advanced Pressing Format (21 Columns + Smart Fuzzy Matching)'}
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
          {(Object.keys(STAGE_DISPLAY_NAMES) as ProductionStageType[]).map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => handleStageChange(st)}
              className={`p-2.5 text-center text-xs font-bold rounded-xl border transition-all cursor-pointer ${
                selectedStage === st
                  ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                  : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
              }`}
            >
              {STAGE_DISPLAY_NAMES[st]}
            </button>
          ))}
        </div>
      </div>

      {/* Safety & Backup Banner */}
      <div className="bg-linear-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center shrink-0 shadow-xs">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-xs font-black text-blue-950">
              {language === 'ar' ? 'إجراء وقائي: أخذ نسخة احتياطية فورية قبل الاستيراد' : 'Safety Check: Pre-import Backup Snapshot'}
            </h3>
            <p className="text-[11px] text-blue-800 mt-0.5">
              {language === 'ar' 
                ? 'يوصى بشدة بإنشاء نسخة احتياطية من قاعدة البيانات الحالية لضمان استرجاع البيانات بأمان في أي وقت.'
                : 'Recommended to generate a backup snapshot of current Firestore documents before batch execution.'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {backupId ? (
            <span className="text-xs font-bold text-emerald-800 bg-emerald-100 border border-emerald-300 px-3 py-1.5 rounded-xl flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <span>{language === 'ar' ? `النسخة الوقائية جاهزة (${backupId})` : `Safety Backup Ready (${backupId})`}</span>
            </span>
          ) : (
            <button
              type="button"
              disabled={isCreatingBackup}
              onClick={handleCreateSafetyBackup}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-xs transition-colors cursor-pointer disabled:opacity-50"
            >
              {isCreatingBackup ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>{language === 'ar' ? 'جاري الحفظ...' : 'Creating...'}</span>
                </>
              ) : (
                <>
                  <Database className="w-4 h-4" />
                  <span>{language === 'ar' ? 'إنشاء نسخة احتياطية وقائية الآن' : 'Create Safety Backup Now'}</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>
      {backupStatusMessage && (
        <div className="text-[11px] font-bold text-blue-900 bg-blue-100/60 px-4 py-1.5 rounded-xl border border-blue-200">
          {backupStatusMessage}
        </div>
      )}

      {/* Upload Dropzone */}
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleFileDrop}
        className="bg-white rounded-2xl border-2 border-dashed border-slate-300 hover:border-emerald-500 p-8 sm:p-12 text-center transition-colors relative cursor-pointer"
      >
        <input
          type="file"
          accept=".xlsx, .xls, .csv"
          onChange={handleFileDrop}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        />

        <div className="flex flex-col items-center justify-center space-y-3 pointer-events-none">
          <div className="w-16 h-16 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center shadow-xs">
            <UploadCloud className="w-8 h-8" />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-900">
              {language === 'ar' 
                ? `اسحب وأفلت ملف Excel لمرحلة (${STAGE_DISPLAY_NAMES[selectedStage]}) هنا أو اضغط للاختيار`
                : `Drop Excel file for (${STAGE_DISPLAY_NAMES[selectedStage]}) or click to browse`}
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              {language === 'ar' 
                ? 'يدعم ملفات .xlsx و .csv. يتم تدقيق الأسماء والأكواد مع المطابقة الذكية في دفعات من 400 سجل.'
                : 'Supports .xlsx & .csv. Automated entity validation and batch commit.'}
            </p>
          </div>
          {file && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-100 text-emerald-900 rounded-lg text-xs font-bold font-mono">
              <FileText className="w-3.5 h-3.5" />
              {file.name} ({(file.size / 1024).toFixed(1)} KB)
            </span>
          )}
        </div>
      </div>

      {isParsing && (
        <div className="p-8 bg-white rounded-2xl border border-slate-200 text-center flex flex-col items-center gap-2">
          <Loader2 className="w-7 h-7 animate-spin text-emerald-600" />
          <span className="text-xs font-bold text-slate-600">
            {language === 'ar' 
              ? 'جاري قراءة وفحص أعمدة وبيانات ملف Excel والمطابقة الذكية مع البيانات الأساسية...'
              : 'Reading and validating Excel sheet with smart fuzzy matching...'}
          </span>
        </div>
      )}

      {/* ========================================================================= */}
      {/* PRESSING STAGE SPECIFIC RICH PREVIEW & VALIDATION SUMMARY                 */}
      {/* ========================================================================= */}
      {selectedStage === 'pressing' && pressingSummary && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5 sm:p-6 space-y-6 animate-in fade-in duration-200">
          {/* Header & Metrics */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-100">
            <div>
              <h2 className="text-base font-black text-slate-900 flex items-center gap-2">
                <Database className="w-5 h-5 text-emerald-600" />
                <span>{language === 'ar' ? 'نتيجة الفحص الشامل لاستيراد المكابس (Pressing Dry-Run)' : 'Pressing Import Dry-Run & Audit'}</span>
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {language === 'ar' 
                  ? `تم تدقيق ${pressingSummary.totalRows} صف في الملف المرفوع وفق الأعمدة الـ 21 المعتمدة`
                  : `Validated ${pressingSummary.totalRows} rows against 21 standard columns`}
              </p>
            </div>

            {/* Comprehensive Metrics Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5">
              <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-200 text-center">
                <span className="text-[10px] font-bold text-slate-500 block">{language === 'ar' ? 'إجمالي الصفوف' : 'Total Rows'}</span>
                <span className="text-sm font-black text-slate-900">{pressingSummary.totalRows}</span>
              </div>
              <div className="p-2.5 bg-emerald-50 rounded-xl border border-emerald-200 text-center">
                <span className="text-[10px] font-bold text-emerald-700 block">{language === 'ar' ? 'جاهز وسليم' : 'Valid'}</span>
                <span className="text-sm font-black text-emerald-600">{pressingSummary.validRows}</span>
              </div>
              <div className="p-2.5 bg-indigo-50 rounded-xl border border-indigo-200 text-center">
                <span className="text-[10px] font-bold text-indigo-700 block">{language === 'ar' ? 'مطابقات معتمدة' : 'Approved Matches'}</span>
                <span className="text-sm font-black text-indigo-600">
                  {pressingSummary.rows.reduce((acc, r) => acc + (r.proposedMatches?.filter(m => m.decision === 'ACCEPTED').length || 0), 0)}
                </span>
              </div>
              <div className="p-2.5 bg-blue-50 rounded-xl border border-blue-200 text-center">
                <span className="text-[10px] font-bold text-blue-700 block">{language === 'ar' ? 'بيانات أساسية مضافة' : 'Added Entities'}</span>
                <span className="text-sm font-black text-blue-600">{addedMasterDataCount}</span>
              </div>
              <div className="p-2.5 bg-slate-100 rounded-xl border border-slate-300 text-center">
                <span className="text-[10px] font-bold text-slate-600 block">{language === 'ar' ? 'تم التخطي' : 'Skipped Items'}</span>
                <span className="text-sm font-black text-slate-700">
                  {pressingSummary.rows.reduce((acc, r) => acc + (r.proposedMatches?.filter(m => m.decision === 'REJECTED').length || 0), 0)}
                </span>
              </div>
              <div className="p-2.5 bg-amber-50 rounded-xl border border-amber-200 text-center">
                <span className="text-[10px] font-bold text-amber-800 block">{language === 'ar' ? 'تنبيهات وفروق' : 'Warnings'}</span>
                <span className="text-sm font-black text-amber-600">{pressingSummary.warningRows}</span>
              </div>
              <div className="p-2.5 bg-red-50 rounded-xl border border-red-200 text-center">
                <span className="text-[10px] font-bold text-red-800 block">{language === 'ar' ? 'أخطاء مانعة' : 'Blocking Errors'}</span>
                <span className="text-sm font-black text-red-600">{pressingSummary.errorRows}</span>
              </div>
            </div>
          </div>

          {/* Smart Match Banner if proposals exist */}
          {totalProposedMatchesCount > 0 && (
            <div className="bg-linear-to-r from-emerald-50 via-teal-50 to-indigo-50 border border-emerald-300/80 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-xs">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-xs font-black text-emerald-950 flex items-center gap-1.5">
                    <span>{language === 'ar' ? 'المطابقة الذكية للبيانات والأسماء التاريخية' : 'Smart Historical Entity Matching'}</span>
                    <span className="px-2 py-0.5 bg-emerald-200 text-emerald-900 rounded-full text-[10px] font-bold">
                      {totalProposedMatchesCount} {language === 'ar' ? 'مطابقة مقترحة' : 'proposals'}
                    </span>
                  </h4>
                  <p className="text-[11px] text-emerald-800 mt-0.5">
                    {language === 'ar' 
                      ? 'تم التعرف الذكي على عمال ومكابس وأصناف وعربات أفران متقاربة. يمكنك اعتماد المطابقات لتصحيح الصفوف تلقائياً.'
                      : 'Fuzzy candidates found. Review and approve to automatically resolve unknown entity errors.'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleAcceptAllHighConfidence}
                  className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-xs transition-colors cursor-pointer"
                >
                  <CheckCheck className="w-4 h-4" />
                  <span>{language === 'ar' ? 'اعتماد كافة التطابقات المؤكدة (≥ 90%)' : 'Accept High-Confidence Matches (≥ 90%)'}</span>
                </button>
              </div>
            </div>
          )}

          {/* Diagnostic Breakdown Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 pt-1">
            <div className="p-2 bg-slate-50 rounded-lg border border-slate-200 text-center">
              <span className="text-[10px] font-bold text-slate-500 block">{language === 'ar' ? 'عمال غير مسجلين' : 'Unknown Workers'}</span>
              <span className={`text-xs font-black ${pressingSummary.unknownEmployeesCount > 0 ? 'text-red-600' : 'text-slate-700'}`}>
                {pressingSummary.unknownEmployeesCount}
              </span>
            </div>
            <div className="p-2 bg-slate-50 rounded-lg border border-slate-200 text-center">
              <span className="text-[10px] font-bold text-slate-500 block">{language === 'ar' ? 'أصناف غير مسجلة' : 'Unknown Products'}</span>
              <span className={`text-xs font-black ${pressingSummary.unknownProductsCount > 0 ? 'text-red-600' : 'text-slate-700'}`}>
                {pressingSummary.unknownProductsCount}
              </span>
            </div>
            <div className="p-2 bg-slate-50 rounded-lg border border-slate-200 text-center">
              <span className="text-[10px] font-bold text-slate-500 block">{language === 'ar' ? 'مكابس غير مسجلة' : 'Unknown Presses'}</span>
              <span className={`text-xs font-black ${pressingSummary.unknownPressesCount > 0 ? 'text-red-600' : 'text-slate-700'}`}>
                {pressingSummary.unknownPressesCount}
              </span>
            </div>
            <div className="p-2 bg-slate-50 rounded-lg border border-slate-200 text-center">
              <span className="text-[10px] font-bold text-slate-500 block">{language === 'ar' ? 'عربات غير مسجلة' : 'Unknown Cars'}</span>
              <span className={`text-xs font-black ${pressingSummary.unknownFurnaceCarsCount > 0 ? 'text-red-600' : 'text-slate-700'}`}>
                {pressingSummary.unknownFurnaceCarsCount}
              </span>
            </div>
            <div className="p-2 bg-slate-50 rounded-lg border border-slate-200 text-center">
              <span className="text-[10px] font-bold text-slate-500 block">{language === 'ar' ? 'أخطاء الوردية' : 'Shift Errors'}</span>
              <span className={`text-xs font-black ${pressingSummary.shiftErrorsCount > 0 ? 'text-red-600' : 'text-slate-700'}`}>
                {pressingSummary.shiftErrorsCount}
              </span>
            </div>
            <div className="p-2 bg-slate-50 rounded-lg border border-slate-200 text-center">
              <span className="text-[10px] font-bold text-slate-500 block">{language === 'ar' ? 'فروق مجموع الأعطال' : 'Fault Mismatches'}</span>
              <span className={`text-xs font-black ${pressingSummary.faultMismatchesCount > 0 ? 'text-amber-600' : 'text-slate-700'}`}>
                {pressingSummary.faultMismatchesCount}
              </span>
            </div>
          </div>

          {/* Filter Tabs */}
          <div className="flex items-center gap-2 border-b border-slate-200 pb-2 overflow-x-auto">
            <button
              type="button"
              onClick={() => setActiveFilterTab('ALL')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                activeFilterTab === 'ALL'
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {language === 'ar' ? `كافة الصفوف (${pressingSummary.totalRows})` : `All Rows (${pressingSummary.totalRows})`}
            </button>

            {totalProposedMatchesCount > 0 && (
              <button
                type="button"
                onClick={() => setActiveFilterTab('MATCHES')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                  activeFilterTab === 'MATCHES'
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'bg-indigo-50 text-indigo-800 hover:bg-indigo-100'
                }`}
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>{language === 'ar' ? `مراجعة المطابقات الذكية (${totalProposedMatchesCount})` : `Smart Matches (${totalProposedMatchesCount})`}</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setActiveFilterTab('VALID')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                activeFilterTab === 'VALID'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
              }`}
            >
              {language === 'ar' ? `جاهزة وسليمة (${pressingSummary.validRows})` : `Valid (${pressingSummary.validRows})`}
            </button>
            <button
              type="button"
              onClick={() => setActiveFilterTab('WARNINGS')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                activeFilterTab === 'WARNINGS'
                  ? 'bg-amber-600 text-white'
                  : 'bg-amber-50 text-amber-800 hover:bg-amber-100'
              }`}
            >
              {language === 'ar' ? `تنبيهات وفروق (${pressingSummary.warningRows})` : `Warnings (${pressingSummary.warningRows})`}
            </button>
            <button
              type="button"
              onClick={() => setActiveFilterTab('ERRORS')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                activeFilterTab === 'ERRORS'
                  ? 'bg-red-600 text-white'
                  : 'bg-red-50 text-red-800 hover:bg-red-100'
              }`}
            >
              {language === 'ar' ? `أخطاء مانعة (${pressingSummary.errorRows})` : `Errors (${pressingSummary.errorRows})`}
            </button>
            <button
              type="button"
              onClick={() => setActiveFilterTab('DUPLICATES')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                activeFilterTab === 'DUPLICATES'
                  ? 'bg-purple-600 text-white'
                  : 'bg-purple-50 text-purple-800 hover:bg-purple-100'
              }`}
            >
              {language === 'ar' ? `سجلات مكررة (${pressingSummary.duplicateRows})` : `Duplicates (${pressingSummary.duplicateRows})`}
            </button>
          </div>

          {/* Full Rich Preview Table */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs font-bold text-slate-700">
              <span>{language === 'ar' ? `معاينة الصفوف المفحوصة (${filteredPressingRows.length} صف معروض):` : `Row Preview (${filteredPressingRows.length} rows):`}</span>
              <span className="text-[11px] text-slate-400 font-mono">{language === 'ar' ? '21 عمود مطابق لقالب المكابس' : '21 Column Standard Matrix'}</span>
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-200 max-h-96">
              <table className="w-full text-right text-xs">
                <thead className="bg-slate-50 text-slate-700 font-black sticky top-0 z-10 border-b border-slate-200 text-[11px]">
                  <tr>
                    <th className="p-2.5 whitespace-nowrap">#</th>
                    <th className="p-2.5 whitespace-nowrap">{language === 'ar' ? 'الحالة' : 'Status'}</th>
                    <th className="p-2.5 whitespace-nowrap">{language === 'ar' ? 'المطابقات الذكية والقرارات' : 'Smart Matches & Actions'}</th>
                    <th className="p-2.5 whitespace-nowrap">{language === 'ar' ? 'التاريخ' : 'Date'}</th>
                    <th className="p-2.5 whitespace-nowrap">{language === 'ar' ? 'عامل 1 (الاسم / السجل)' : 'Worker 1'}</th>
                    <th className="p-2.5 whitespace-nowrap">{language === 'ar' ? 'عامل 2 (الاسم / السجل)' : 'Worker 2'}</th>
                    <th className="p-2.5 whitespace-nowrap">{language === 'ar' ? 'رقم العربات' : 'Furnace Cars'}</th>
                    <th className="p-2.5 whitespace-nowrap">{language === 'ar' ? 'المكبس' : 'Press'}</th>
                    <th className="p-2.5 whitespace-nowrap">{language === 'ar' ? 'طلب العميل' : 'Customer Order'}</th>
                    <th className="p-2.5 whitespace-nowrap">{language === 'ar' ? 'الوردية' : 'Shift'}</th>
                    <th className="p-2.5 whitespace-nowrap">{language === 'ar' ? 'كود الصنف' : 'Product Code'}</th>
                    <th className="p-2.5 whitespace-nowrap">{language === 'ar' ? 'اسم الصنف' : 'Product Name'}</th>
                    <th className="p-2.5 whitespace-nowrap">{language === 'ar' ? 'الألومينا %' : 'Alumina %'}</th>
                    <th className="p-2.5 whitespace-nowrap">{language === 'ar' ? 'وزن القطعة' : 'Piece Weight'}</th>
                    <th className="p-2.5 whitespace-nowrap">{language === 'ar' ? 'الإنتاج' : 'Production'}</th>
                    <th className="p-2.5 whitespace-nowrap">{language === 'ar' ? 'الهالك' : 'Waste'}</th>
                    <th className="p-2.5 whitespace-nowrap">{language === 'ar' ? 'ميكانيكا' : 'Mechanical'}</th>
                    <th className="p-2.5 whitespace-nowrap">{language === 'ar' ? 'كهرباء' : 'Electrical'}</th>
                    <th className="p-2.5 whitespace-nowrap">{language === 'ar' ? 'ورشة' : 'Workshop'}</th>
                    <th className="p-2.5 whitespace-nowrap">{language === 'ar' ? 'خامات' : 'Raw Material'}</th>
                    <th className="p-2.5 whitespace-nowrap">{language === 'ar' ? 'أخرى' : 'Other'}</th>
                    <th className="p-2.5 whitespace-nowrap">{language === 'ar' ? 'إجمالي الأعطال' : 'Total Faults'}</th>
                    <th className="p-2.5 whitespace-nowrap min-w-[220px]">{language === 'ar' ? 'الملاحظات والأخطاء' : 'Notes & Errors'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
                  {filteredPressingRows.map((row) => (
                    <tr 
                      key={row.rowIndex}
                      className={`hover:bg-slate-50 transition-colors ${
                        row.errors.length > 0 
                          ? 'bg-red-50/40' 
                          : row.warnings.length > 0 
                            ? 'bg-amber-50/30' 
                            : ''
                      }`}
                    >
                      <td className="p-2.5 font-bold text-slate-500">{row.rowIndex}</td>
                      <td className="p-2.5">{renderStatusBadge(row)}</td>

                      {/* Smart Fuzzy Match Decision & Action Column */}
                      <td className="p-2.5 font-sans min-w-[260px]">
                        <div className="space-y-2">
                          {row.proposedMatches && row.proposedMatches.length > 0 && (
                            <div className="space-y-2">
                              {row.proposedMatches.map((prop, mIdx) => (
                                <div 
                                  key={mIdx}
                                  className={`p-2 rounded-lg border text-[11px] ${
                                    prop.decision === 'ACCEPTED'
                                      ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                                      : prop.decision === 'REJECTED'
                                        ? 'bg-slate-100 border-slate-200 text-slate-500'
                                        : 'bg-indigo-50/70 border-indigo-200 text-indigo-950'
                                  }`}
                                >
                                  <div className="flex items-center justify-between gap-1 font-bold">
                                    <span className="flex items-center gap-1">
                                      <Sparkles className="w-3 h-3 text-indigo-600 shrink-0" />
                                      {prop.fieldNameAr || prop.fieldDomain}
                                    </span>
                                    <span className={`px-1.5 py-0.2 rounded text-[10px] ${
                                      prop.confidence >= 90 
                                        ? 'bg-emerald-100 text-emerald-800' 
                                        : 'bg-amber-100 text-amber-800'
                                    }`}>
                                      {prop.confidence}%
                                    </span>
                                  </div>

                                  <div className="mt-1 text-[11px]">
                                    <span className="text-slate-500">{language === 'ar' ? 'الملف: ' : 'Imported: '}</span>
                                    <span className="font-bold">{prop.importedValue}</span>
                                    <span className="text-indigo-600 mx-1">&rarr;</span>
                                    <span className="font-black text-indigo-900">{prop.suggestedName}</span>
                                  </div>

                                  {/* Actions: Approve / Add / Skip */}
                                  <div className="mt-2 pt-1 border-t border-indigo-100/80">
                                    {prop.decision === 'ACCEPTED' ? (
                                      <span className="text-emerald-700 font-bold flex items-center gap-1 text-[10px]">
                                        <Check className="w-3 h-3" />
                                        {language === 'ar' ? 'تم الاعتماد' : 'Approved'}
                                      </span>
                                    ) : prop.decision === 'REJECTED' ? (
                                      <div className="flex items-center justify-between gap-1">
                                        <span className="text-slate-500 font-bold flex items-center gap-1 text-[10px]">
                                          <Ban className="w-3 h-3 text-slate-400" />
                                          {language === 'ar' ? 'تم التخطي' : 'Skipped'}
                                        </span>
                                        {canAddMasterData && (
                                          <button
                                            type="button"
                                            onClick={() => handleOpenInlineAdd(prop.fieldDomain, prop.importedValue, row.rowIndex)}
                                            className="px-1.5 py-0.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded text-[9px] font-bold cursor-pointer"
                                          >
                                            {language === 'ar' ? 'إضافة كعنصر جديد' : 'Add as new'}
                                          </button>
                                        )}
                                      </div>
                                    ) : (
                                      <div className="flex flex-wrap items-center gap-1.5">
                                        {/* 1. [Approve] / [اعتماد] */}
                                        <button
                                          type="button"
                                          onClick={() => handleAcceptProposedMatch(row.rowIndex, mIdx)}
                                          className="px-2 py-0.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded font-bold text-[10px] cursor-pointer flex items-center gap-0.5 shadow-xs"
                                          title={language === 'ar' ? 'اعتماد المطابقة المقترحة' : 'Approve suggested match'}
                                        >
                                          <Check className="w-3 h-3" />
                                          <span>{language === 'ar' ? 'اعتماد' : 'Approve'}</span>
                                        </button>

                                        {/* 2. [Add] / [إضافة] */}
                                        {canAddMasterData && (
                                          <button
                                            type="button"
                                            onClick={() => handleOpenInlineAdd(prop.fieldDomain, prop.importedValue, row.rowIndex)}
                                            className="px-2 py-0.5 bg-blue-600 hover:bg-blue-700 text-white rounded font-bold text-[10px] cursor-pointer flex items-center gap-0.5 shadow-xs"
                                            title={language === 'ar' ? 'إضافة إلى البيانات الأساسية' : 'Add to Master Data'}
                                          >
                                            <Plus className="w-3 h-3" />
                                            <span>{language === 'ar' ? 'إضافة' : 'Add'}</span>
                                          </button>
                                        )}

                                        {/* Candidates switcher if multiple */}
                                        {prop.candidates && prop.candidates.length > 1 && (
                                          <select
                                            onChange={(e) => {
                                              const cId = e.target.value;
                                              const cand = prop.candidates?.find(c => c.id === cId);
                                              if (cand) handleAcceptProposedMatch(row.rowIndex, mIdx, cand);
                                            }}
                                            className="text-[10px] bg-white border border-slate-300 rounded px-1 py-0.5 cursor-pointer"
                                            defaultValue=""
                                          >
                                            <option value="" disabled>{language === 'ar' ? 'بدائل أخرى...' : 'Other...'}</option>
                                            {prop.candidates.map((c) => (
                                              <option key={c.id} value={c.id}>
                                                {c.name} ({c.confidence}%)
                                              </option>
                                            ))}
                                          </select>
                                        )}

                                        {/* 3. [Skip] / [تخطي] */}
                                        <button
                                          type="button"
                                          onClick={() => handleSkipProposedMatch(row.rowIndex, mIdx)}
                                          className="px-1.5 py-0.5 text-slate-600 hover:text-red-700 hover:bg-red-50 rounded text-[10px] font-bold cursor-pointer transition-colors"
                                          title={language === 'ar' ? 'تخطي هذا البيان' : 'Skip this item'}
                                        >
                                          {language === 'ar' ? 'تخطي' : 'Skip'}
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Direct Quick Add for Unresolved Entity Errors */}
                          {canAddMasterData && (
                            <div className="flex flex-wrap gap-1">
                              {row.worker1Name && !row.resolvedWorker1 && !row.proposedMatches?.some(m => (m.fieldDomain === 'worker1' || m.fieldDomain === 'employee1') && m.decision === 'ACCEPTED') && (
                                <button
                                  type="button"
                                  onClick={() => handleOpenInlineAdd('employee', row.worker1Name, row.rowIndex, { suggestedCode: row.worker1Code })}
                                  className="text-[9px] px-1.5 py-0.5 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 rounded font-bold flex items-center gap-0.5 cursor-pointer"
                                >
                                  <Plus className="w-2.5 h-2.5 text-amber-700" />
                                  <span>{language === 'ar' ? `+ إضافة عامل 1 (${row.worker1Name})` : `+ Add Worker 1`}</span>
                                </button>
                              )}
                              {row.pressRaw && !row.resolvedPress && !row.proposedMatches?.some(m => m.fieldDomain === 'press' && m.decision === 'ACCEPTED') && (
                                <button
                                  type="button"
                                  onClick={() => handleOpenInlineAdd('press', row.pressRaw, row.rowIndex)}
                                  className="text-[9px] px-1.5 py-0.5 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 rounded font-bold flex items-center gap-0.5 cursor-pointer"
                                >
                                  <Plus className="w-2.5 h-2.5 text-amber-700" />
                                  <span>{language === 'ar' ? `+ إضافة مكبس (${row.pressRaw})` : `+ Add Press`}</span>
                                </button>
                              )}
                              {row.productCodeRaw && !row.resolvedProduct && !row.proposedMatches?.some(m => m.fieldDomain === 'product' && m.decision === 'ACCEPTED') && (
                                <button
                                  type="button"
                                  onClick={() => handleOpenInlineAdd('product', row.productNameRaw || row.productCodeRaw, row.rowIndex, { code: row.productCodeRaw, pieceWeight: row.pieceWeight, aluminaPercentage: row.aluminaPercentage })}
                                  className="text-[9px] px-1.5 py-0.5 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 rounded font-bold flex items-center gap-0.5 cursor-pointer"
                                >
                                  <Plus className="w-2.5 h-2.5 text-amber-700" />
                                  <span>{language === 'ar' ? `+ إضافة صنف (${row.productCodeRaw})` : `+ Add Product`}</span>
                                </button>
                              )}
                              {row.furnaceCarsRaw && (!row.resolvedFurnaceCars || row.resolvedFurnaceCars.length === 0) && !row.proposedMatches?.some(m => m.fieldDomain === 'furnaceCar' && m.decision === 'ACCEPTED') && (
                                <button
                                  type="button"
                                  onClick={() => handleOpenInlineAdd('furnaceCar', row.furnaceCarsRaw, row.rowIndex)}
                                  className="text-[9px] px-1.5 py-0.5 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 rounded font-bold flex items-center gap-0.5 cursor-pointer"
                                >
                                  <Plus className="w-2.5 h-2.5 text-amber-700" />
                                  <span>{language === 'ar' ? `+ إضافة عربة (${row.furnaceCarsRaw})` : `+ Add Car`}</span>
                                </button>
                              )}
                            </div>
                          )}

                          {(!row.proposedMatches || row.proposedMatches.length === 0) && row.errors.length === 0 && (
                            <span className="text-slate-400 font-sans text-[10px]">-</span>
                          )}
                        </div>
                      </td>

                      <td className="p-2.5 whitespace-nowrap text-slate-900 font-bold">{row.date || '-'}</td>
                      
                      {/* Worker 1 */}
                      <td className="p-2.5 whitespace-nowrap">
                        <div className="font-sans font-bold text-slate-900">{row.worker1Name || '-'}</div>
                        <div className="text-[10px] text-slate-500">{language === 'ar' ? 'كود' : 'Code'}: {row.worker1Code || '-'}</div>
                      </td>

                      {/* Worker 2 */}
                      <td className="p-2.5 whitespace-nowrap">
                        <div className="font-sans font-bold text-slate-700">{row.worker2Name || '-'}</div>
                        {row.worker2Code && <div className="text-[10px] text-slate-500">{language === 'ar' ? 'كود' : 'Code'}: {row.worker2Code}</div>}
                      </td>

                      {/* Furnace Cars */}
                      <td className="p-2.5 whitespace-nowrap font-bold text-blue-700">
                        {row.furnaceCarsRaw || '-'}
                      </td>

                      {/* Press */}
                      <td className="p-2.5 whitespace-nowrap font-sans font-bold text-slate-800">
                        {row.resolvedPress?.name || row.pressRaw || '-'}
                      </td>

                      {/* Customer Order */}
                      <td className="p-2.5 whitespace-nowrap font-sans text-slate-700">
                        {row.customerOrder || '-'}
                      </td>

                      {/* Shift */}
                      <td className="p-2.5 whitespace-nowrap font-bold text-center">
                        <span className={`px-2 py-0.5 rounded text-[10px] ${row.resolvedShift ? 'bg-slate-100 text-slate-800' : 'bg-red-100 text-red-800'}`}>
                          {row.resolvedShift?.name || row.shiftRaw || '-'}
                        </span>
                      </td>

                      {/* Product Code */}
                      <td className="p-2.5 whitespace-nowrap font-bold text-indigo-700">
                        {row.productCodeRaw || '-'}
                      </td>

                      {/* Product Name */}
                      <td className="p-2.5 whitespace-nowrap font-sans font-bold text-slate-900">
                        {row.resolvedProduct?.name || row.productNameRaw || '-'}
                      </td>

                      {/* Alumina % */}
                      <td className="p-2.5 whitespace-nowrap text-center font-bold text-purple-700">
                        {row.aluminaPercentage}%
                      </td>

                      {/* Piece Weight */}
                      <td className="p-2.5 whitespace-nowrap text-center">
                        {row.pieceWeight > 0 ? `${row.pieceWeight} ${language === 'ar' ? 'كجم' : 'kg'}` : '-'}
                      </td>

                      {/* Production & Waste */}
                      <td className="p-2.5 whitespace-nowrap text-emerald-700 font-bold text-center">
                        {formatNumber(row.productionQuantity)}
                      </td>
                      <td className="p-2.5 whitespace-nowrap text-red-700 font-bold text-center">
                        {formatNumber(row.wasteQuantity)}
                      </td>

                      {/* Faults breakdown */}
                      <td className="p-2.5 text-center text-slate-600">{row.mechanicalFaults || 0}</td>
                      <td className="p-2.5 text-center text-slate-600">{row.electricalFaults || 0}</td>
                      <td className="p-2.5 text-center text-slate-600">{row.workshopFaults || 0}</td>
                      <td className="p-2.5 text-center text-slate-600">{row.rawMaterialFaults || 0}</td>
                      <td className="p-2.5 text-center text-slate-600">{row.otherFaults || 0}</td>

                      {/* Calculated vs Excel Total Faults */}
                      <td className="p-2.5 whitespace-nowrap text-center font-bold">
                        <span className="text-slate-900">{row.calculatedTotalFaults} {language === 'ar' ? 'د' : 'm'}</span>
                        {row.excelTotalFaults !== undefined && (
                          <span className={`text-[10px] mr-1 ${row.excelTotalFaults === row.calculatedTotalFaults ? 'text-slate-400' : 'text-amber-700 font-bold'}`}>
                            ({row.excelTotalFaults} {language === 'ar' ? 'د' : 'm'})
                          </span>
                        )}
                      </td>

                      {/* Notes / Issues */}
                      <td className="p-2.5 font-sans">
                        {row.errors.length > 0 ? (
                          <div className="text-red-700 font-bold text-[11px] space-y-0.5">
                            {row.errors.map((e, idx) => (
                              <div key={idx}>• {e}</div>
                            ))}
                          </div>
                        ) : row.warnings.length > 0 ? (
                          <div className="text-amber-800 text-[11px] space-y-0.5">
                            {row.warnings.map((w, idx) => (
                              <div key={idx}>• {w}</div>
                            ))}
                          </div>
                        ) : (
                          <span className="text-emerald-700 text-[11px] font-bold">
                            {language === 'ar' ? 'بيانات مطابقة تماماً' : 'Fully Validated'}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Action Footer */}
          {isImporting ? (
            <div className="space-y-3 pt-3 bg-slate-50 p-4 rounded-xl border border-slate-200">
              <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                <span className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
                  <span>
                    {language === 'ar' 
                      ? `جاري استيراد الدفعة ${currentBatchNum} من ${totalBatchCount} إلى قاعدة بيانات الإنتاج (Firestore)...`
                      : `Importing chunk ${currentBatchNum} of ${totalBatchCount} to Firestore...`}
                  </span>
                </span>
                <span>{importProgress}%</span>
              </div>
              <div className="w-full h-3 bg-slate-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-600 transition-all duration-300"
                  style={{ width: `${importProgress}%` }}
                />
              </div>
            </div>
          ) : (
            <div className="space-y-4 pt-4 border-t border-slate-100">
              {/* Blocking Errors Alert vs Ready Confirmation */}
              {pressingSummary.errorRows > 0 ? (
                <div className="p-3.5 bg-red-50 border-2 border-red-300 rounded-xl flex items-start gap-3">
                  <ShieldAlert className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                  <div className="flex-1 text-xs">
                    <h4 className="font-black text-red-950">
                      {language === 'ar' ? 'أخطاء مانعة تمنع الاعتماد النهائي:' : 'Blocking Issues Prevent Final Import:'}
                    </h4>
                    <p className="text-red-800 mt-0.5 font-medium">
                      {language === 'ar' 
                        ? `يوجد (${pressingSummary.errorRows}) صف به أخطاء مانعة (عناصر غير مسجلة أو بيانات إلزامية مفقودة). يجب حل جميع الأخطاء إما باعتماد المطابقات المقترحة أو إضافة البيانات الأساسية الجديدة قبل السماح بالاستيراد النهائي إلى قاعدة البيانات.`
                        : `There are (${pressingSummary.errorRows}) rows with blocking errors. You must resolve all issues via Approve, Add, or editing before final import execution is enabled.`}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="p-3 bg-emerald-50 border border-emerald-300 rounded-xl flex items-center gap-3">
                  <CheckCircle className="w-5 h-5 text-emerald-600 shrink-0" />
                  <div className="text-xs">
                    <span className="font-black text-emerald-950">
                      {language === 'ar' ? 'كافة البيانات جاهزة ومدققة بالكامل:' : 'All Data Fully Validated & Ready:'}
                    </span>{' '}
                    <span className="text-emerald-800 font-medium">
                      {language === 'ar' 
                        ? `تم التحقق من كافة الحقول والتطابقات بنجاح. يمكنك الآن اعتماد واستكمال الرفع النهائي (${pressingSummary.validRows + pressingSummary.warningRows} سجل).`
                        : `All rows and entities are verified. Ready to commit ${pressingSummary.validRows + pressingSummary.warningRows} records directly to Firestore.`}
                    </span>
                  </div>
                </div>
              )}

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="text-xs text-slate-600">
                  <span>{language === 'ar' ? 'سيتم استيراد: ' : 'Will import: '}</span>
                  <strong className="text-emerald-700 font-bold">
                    {pressingSummary.validRows + pressingSummary.warningRows} {language === 'ar' ? 'سجل صالح' : 'valid records'}
                  </strong>
                  {addedMasterDataCount > 0 && (
                    <span className="text-blue-700 font-bold mx-1">
                      {language === 'ar' ? `+ (${addedMasterDataCount}) عنصر بيانات أساسية مضاف` : `+ (${addedMasterDataCount}) new master data`}
                    </span>
                  )}
                  {pressingSummary.errorRows > 0 && (
                    <span className="text-red-600 font-bold mx-1">
                      {language === 'ar' ? `(متبقي ${pressingSummary.errorRows} خطأ مانع)` : `(${pressingSummary.errorRows} blocking errors remaining)`}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setPressingSummary(null)}
                    className="px-4 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
                  >
                    {language === 'ar' ? 'إلغاء المعاينة' : 'Cancel'}
                  </button>
                  <button
                    type="button"
                    disabled={pressingSummary.errorRows > 0 || (pressingSummary.validRows + pressingSummary.warningRows === 0)}
                    onClick={handleStartImport}
                    className="flex items-center gap-2 px-6 py-2.5 text-xs font-black text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl shadow-md transition-all cursor-pointer"
                    title={pressingSummary.errorRows > 0 ? (language === 'ar' ? 'غير متاح حتى حل جميع الأخطاء المانعة' : 'Disabled until all blocking errors are resolved') : ''}
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>
                      {language === 'ar' 
                        ? `اعتماد واستكمال الرفع (${pressingSummary.validRows + pressingSummary.warningRows} سجل)`
                        : `Approve & Continue Import (${pressingSummary.validRows + pressingSummary.warningRows} records)`}
                    </span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* GENERIC DRY-RUN FOR OTHER 7 STAGES (FALLBACK)                             */}
      {/* ========================================================================= */}
      {selectedStage !== 'pressing' && genericValidation && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5 sm:p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
            <div>
              <h2 className="text-base font-black text-slate-900 flex items-center gap-2">
                <Database className="w-5 h-5 text-emerald-600" />
                <span>{language === 'ar' ? `نتيجة الفحص الأولي لمرحلة ${STAGE_DISPLAY_NAMES[selectedStage]}` : `Pre-validation result for ${STAGE_DISPLAY_NAMES[selectedStage]}`}</span>
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {language === 'ar' ? `تم فحص ${genericRawRows.length} صف في الملف المرفوع` : `Validated ${genericRawRows.length} rows`}
              </p>
            </div>

            <div className="flex items-center gap-4">
              <div className="text-center">
                <span className="text-[11px] font-bold text-slate-500 block">{language === 'ar' ? 'صفوف جاهزة' : 'Valid Rows'}</span>
                <span className="text-base font-black text-emerald-600">{genericValidation.validRows.length}</span>
              </div>
              <div className="text-center">
                <span className="text-[11px] font-bold text-slate-500 block">{language === 'ar' ? 'أخطاء' : 'Errors'}</span>
                <span className="text-base font-black text-red-600">{genericValidation.errors.length}</span>
              </div>
            </div>
          </div>

          {/* Action */}
          {isImporting ? (
            <div className="space-y-2 pt-2">
              <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                <span>{language === 'ar' ? 'جاري إرسال السجلات إلى Firestore...' : 'Writing batch to Firestore...'}</span>
                <span>{importProgress}%</span>
              </div>
              <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-600 transition-all duration-300"
                  style={{ width: `${importProgress}%` }}
                />
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setGenericValidation(null)}
                className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
              >
                {language === 'ar' ? 'إلغاء' : 'Cancel'}
              </button>
              <button
                type="button"
                disabled={genericValidation.validRows.length === 0}
                onClick={handleStartImport}
                className="flex items-center gap-2 px-6 py-2.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 rounded-xl shadow-md transition-all cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>
                  {language === 'ar' ? `تنفيذ الاستيراد (${genericValidation.validRows.length} سجل)` : `Execute Import (${genericValidation.validRows.length} records)`}
                </span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Post-Import Audit Summary */}
      {importResult && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-6 text-center space-y-4 animate-in fade-in duration-200">
          <div className="w-12 h-12 rounded-2xl bg-emerald-600 text-white flex items-center justify-center mx-auto shadow-xs">
            <CheckCircle2 className="w-7 h-7" />
          </div>
          <div>
            <h2 className="text-lg font-black text-emerald-950">
              {language === 'ar' 
                ? `تم الانتهاء من عملية الاستيراد التاريخي لمرحلة (${STAGE_DISPLAY_NAMES[selectedStage]}) بنجاح!`
                : `Historical import completed for (${STAGE_DISPLAY_NAMES[selectedStage]})!`}
            </h2>
            <p className="text-xs text-emerald-800 font-mono mt-1">
              {language === 'ar' ? 'رقم العملية الموثقة' : 'Import Batch ID'}: {importResult.importId} {backupId ? `| ${language === 'ar' ? 'النسخة الوقائية' : 'Backup ID'}: ${backupId}` : ''}
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-6 text-xs font-bold text-emerald-900 bg-white/70 p-4 rounded-xl border border-emerald-200 max-w-xl mx-auto">
            <div>
              <span className="text-slate-500 block text-[11px]">{language === 'ar' ? 'إجمالي السجلات' : 'Total'}</span>
              <span className="text-base font-black text-slate-800">{importResult.total}</span>
            </div>
            <div>
              <span className="text-emerald-700 block text-[11px]">{language === 'ar' ? 'تم استيرادها بنجاح' : 'Imported'}</span>
              <span className="text-base font-black text-emerald-600">{importResult.imported}</span>
            </div>
            <div>
              <span className="text-amber-700 block text-[11px]">{language === 'ar' ? 'تم تخطيها' : 'Skipped'}</span>
              <span className="text-base font-black text-amber-600">{importResult.skipped}</span>
            </div>
            {importResult.failed > 0 && (
              <div>
                <span className="text-red-700 block text-[11px]">{language === 'ar' ? 'فشلت' : 'Failed'}</span>
                <span className="text-base font-black text-red-600">{importResult.failed}</span>
              </div>
            )}
          </div>

          <p className="text-[11px] text-emerald-700 font-sans">
            {language === 'ar' 
              ? 'السجلات المستوردة متاحة الآن فورياً في سجلات الإنتاج، لوحة المتابعة، التقارير التحليلية، ومساعد الذكاء الاصطناعي.'
              : 'Imported records are immediately available in Dashboard, Production Logs, Reports, and AI.'}
          </p>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: Historical Import Audit History & Rollback                         */}
      {/* ========================================================================= */}
      <Modal
        isOpen={isHistoryModalOpen}
        onClose={() => setIsHistoryModalOpen(false)}
        title={language === 'ar' ? 'سجل عمليات الاستيراد التاريخي والتراجع' : 'Import Audit Trail & Rollback (Undo)'}
        subtitle={language === 'ar' ? 'توثيق كافة دفعات الاستيراد السابقة مع إمكانية التراجع الآمن عن أي دفعة' : 'Complete audit of previous imports with safe batch rollback'}
        maxWidth="2xl"
      >
        <div className="space-y-4 text-xs" dir={isRtl ? 'rtl' : 'ltr'}>
          {rollbackSuccessMsg && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl flex items-center gap-2 font-bold">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{rollbackSuccessMsg}</span>
            </div>
          )}

          {isLoadingHistory ? (
            <div className="p-8 text-center text-slate-500 flex flex-col items-center gap-2">
              <Loader2 className="w-6 h-6 animate-spin text-emerald-600" />
              <span>{language === 'ar' ? 'جاري تحميل سجلات الاستيراد...' : 'Loading import history...'}</span>
            </div>
          ) : importHistory.length === 0 ? (
            <div className="p-8 text-center bg-slate-50 rounded-xl border border-slate-200 text-slate-500">
              <FileSpreadsheet className="w-8 h-8 text-slate-400 mx-auto mb-2" />
              <p className="font-bold">{language === 'ar' ? 'لا توجد عمليات استيراد سابقة مسجلة حتى الآن.' : 'No historical import operations recorded yet.'}</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 max-h-96 overflow-y-auto rounded-xl border border-slate-200">
              {importHistory.map((entry) => (
                <div key={entry.importBatchId} className="p-3.5 hover:bg-slate-50 flex items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-900 font-mono text-[11px]">{entry.importBatchId}</span>
                      <span className="px-2 py-0.5 bg-slate-100 text-slate-700 rounded text-[10px] font-bold">
                        {STAGE_DISPLAY_NAMES[entry.stage as ProductionStageType] || entry.stage}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 flex items-center gap-3">
                      <span>الملف: <strong className="text-slate-700">{entry.fileName}</strong></span>
                      <span>بواسطة: <strong className="text-slate-700">{entry.performedByName || entry.performedBy}</strong></span>
                      <span>التاريخ: <strong className="text-slate-700">{entry.performedAt ? formatDateTime(entry.performedAt) : '-'}</strong></span>
                    </div>
                    <div className="text-[10px] text-emerald-700 font-bold">
                      تم استيراد {entry.importedCount} سجل | {entry.approvedMappingsCount || 0} مطابقة ذكية معتمدة
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setRollbackTargetBatch(entry)}
                    className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg text-xs font-bold transition-colors cursor-pointer flex items-center gap-1 shrink-0"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>{language === 'ar' ? 'تراجع عن الدفعة' : 'Rollback'}</span>
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center justify-end pt-3 border-t border-slate-200">
            <button
              type="button"
              onClick={() => setIsHistoryModalOpen(false)}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg cursor-pointer"
            >
              {language === 'ar' ? 'إغلاق' : 'Close'}
            </button>
          </div>
        </div>
      </Modal>

      {/* ========================================================================= */}
      {/* MODAL: Confirm Rollback Batch                                             */}
      {/* ========================================================================= */}
      <Modal
        isOpen={!!rollbackTargetBatch}
        onClose={() => setRollbackTargetBatch(null)}
        title={language === 'ar' ? 'تأكيد التراجع عن دفعة الاستيراد (Rollback Import)' : 'Confirm Batch Rollback'}
        subtitle={rollbackTargetBatch ? `${language === 'ar' ? 'الدفعة' : 'Batch'}: ${rollbackTargetBatch.importBatchId}` : ''}
        maxWidth="sm"
      >
        <div className="space-y-4 text-xs" dir={isRtl ? 'rtl' : 'ltr'}>
          <p className="text-slate-700 leading-relaxed">
            {language === 'ar'
              ? `هل أنت متأكد من رغبتك في التراجع عن استيراد ملف (${rollbackTargetBatch?.fileName})؟ سيتم حذف جميع السجلات (${rollbackTargetBatch?.importedCount} سجل) التي أُنشئت في هذه الدفعة من قاعدة البيانات نهائياً.`
              : `Are you sure you want to rollback batch ${rollbackTargetBatch?.importBatchId}? All ${rollbackTargetBatch?.importedCount} imported records will be safely removed.`}
          </p>

          <div className="p-3 bg-rose-50 rounded-xl border border-rose-200 text-rose-800 text-[11px] font-bold">
            {language === 'ar' 
              ? 'تنبيه: لا يمكن التراجع عن عملية الحذف هذه، لكن سيتم توثيق إجراء التراجع في سجل المراجعة (Audit Log).'
              : 'This action is irreversible and will be logged in the audit trail.'}
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={() => setRollbackTargetBatch(null)}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg cursor-pointer"
            >
              {language === 'ar' ? 'إلغاء' : 'Cancel'}
            </button>
            <button
              type="button"
              disabled={isRollingBack}
              onClick={handleConfirmRollback}
              className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-lg flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              {isRollingBack ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>{language === 'ar' ? 'جاري الحذف والتراجع...' : 'Rolling back...'}</span>
                </>
              ) : (
                <>
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>{language === 'ar' ? 'تأكيد التراجع والحذف' : 'Confirm Rollback'}</span>
                </>
              )}
            </button>
          </div>
        </div>
      </Modal>
      {/* ========================================================================= */}
      {/* MODAL: Inline Master Data Quick Add                                       */}
      {/* ========================================================================= */}
      <InlineMasterDataAddModal
        isOpen={inlineAddModalState.isOpen}
        onClose={() => setInlineAddModalState(prev => ({ ...prev, isOpen: false }))}
        onSuccess={handleMasterDataCreated}
        domain={inlineAddModalState.domain}
        importedValue={inlineAddModalState.importedValue}
        extraContext={inlineAddModalState.extraContext}
        existingItems={existingMasterDataList}
      />
    </div>
  );
};
