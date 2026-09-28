/**
 * A Master Data record in full - opened by double-clicking its row (3.23.0).
 *
 * Read-only: every field the record carries, labelled and ordered by
 * recordDetailFields (masterDataDetailsPure.ts). It reads nothing - the record
 * is the row already on screen - and changes nothing; editing stays on the
 * row's existing Edit button, behind its existing permission.
 */
import React, { useMemo } from 'react';
import { Modal } from '../common/Modal';
import { useLanguage } from '../../i18n/LanguageContext';
import { recordDetailFields } from '../../services/masterDataDetailsPure';

interface RecordDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  record: Record<string, any> | null;
  /** The section's name, shown above the record. */
  sectionLabel: string;
  /** The code the table shows for this record. */
  code: string;
  /** Turns an id field into the label the table shows (a customer, a product, ...), or null. */
  resolve?: (key: string, value: unknown) => string | null;
}

export const RecordDetailsModal: React.FC<RecordDetailsModalProps> = ({ isOpen, onClose, record, sectionLabel, code, resolve }) => {
  const { language } = useLanguage();
  const isAr = language === 'ar';
  const fields = useMemo(() => recordDetailFields(record, isAr ? 'ar' : 'en', resolve), [record, isAr, resolve]);

  return (
    <Modal
      id="master-data-record-details"
      isOpen={isOpen}
      onClose={onClose}
      title={`${code || '-'}${record?.name ? ` - ${record.name}` : ''}`}
      subtitle={isAr ? `${sectionLabel} · تفاصيل السجل` : `${sectionLabel} · Record details`}
      maxWidth="2xl"
    >
      <div className="text-xs" dir={isAr ? 'rtl' : 'ltr'}>
        <table id="master-data-record-fields" className="w-full border border-slate-200 rounded-xl overflow-hidden">
          <tbody className="divide-y divide-slate-100">
            {fields.map((f) => (
              <tr key={f.key} className="align-top">
                <td className="w-1/3 px-3 py-2 bg-slate-50 font-bold text-slate-600">{isAr ? f.labelAr : f.labelEn}</td>
                <td className="px-3 py-2 text-slate-900">
                  {f.block ? (
                    <pre className="whitespace-pre-wrap break-words font-mono text-[11px] bg-slate-50 rounded-lg p-2" dir="ltr">{f.value}</pre>
                  ) : (
                    <span className="break-words">{f.value}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
};
