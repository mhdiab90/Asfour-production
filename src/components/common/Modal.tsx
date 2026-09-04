import React, { useEffect, useId } from 'react';
import { X } from 'lucide-react';

/**
 * Shared stacking-order registry for every currently-open Modal instance
 * across the whole app (module-level, not component state - a modal opened
 * from WITHIN another already-open modal, e.g. a "Create New" dialog
 * launched from a review window, needs to know about its sibling). Used
 * only to (a) make Escape close just the TOPMOST open dialog instead of
 * every open dialog at once, and (b) keep the body scroll lock active as
 * long as ANY modal remains open, rather than a nested dialog's own close
 * prematurely unlocking scroll while its parent modal is still open.
 */
const openModalStack: string[] = [];

interface ModalProps {
  id?: string;
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '4xl';
  /**
   * Stacking layer for a dialog that may be opened from WITHIN another
   * already-open Modal (e.g. a "Create New" mini-form launched from a
   * review window). Defaults to 'base' - the exact z-50 layer every
   * existing Modal usage already renders at, so omitting this prop changes
   * nothing anywhere else in the app. Pass 'nested' only for a dialog whose
   * own trigger lives inside another Modal's content, so it always paints
   * above it regardless of DOM/render order.
   */
  layer?: 'base' | 'nested';
}

export const Modal: React.FC<ModalProps> = ({
  id,
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  maxWidth = 'lg',
  layer = 'base',
}) => {
  const instanceId = useId();

  useEffect(() => {
    if (!isOpen) return;
    openModalStack.push(instanceId);
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (e: KeyboardEvent) => {
      // Only the topmost currently-open modal responds to Escape - with two
      // modals open (e.g. Master Data Review + a nested Create New dialog),
      // this stops Escape from closing both at once.
      if (e.key === 'Escape' && openModalStack[openModalStack.length - 1] === instanceId) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      const idx = openModalStack.indexOf(instanceId);
      if (idx !== -1) openModalStack.splice(idx, 1);
      window.removeEventListener('keydown', handleKeyDown);
      // Only release the body scroll lock once NO modal remains open -
      // closing a nested dialog must never unlock scrolling while its
      // parent modal is still open behind it.
      if (openModalStack.length === 0) {
        document.body.style.overflow = 'unset';
      }
    };
  }, [isOpen, onClose, instanceId]);

  if (!isOpen) return null;

  const maxWidthClass = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
    '2xl': 'max-w-2xl',
    '4xl': 'max-w-4xl',
  }[maxWidth];

  const zIndexClass = layer === 'nested' ? 'z-[60]' : 'z-50';

  return (
    <div
      id={id}
      className={`fixed inset-0 ${zIndexClass} flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200`}
      onClick={onClose}
    >
      <div
        className={`w-full ${maxWidthClass} bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden max-h-[90vh] flex flex-col`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/70">
          <div>
            <h3 className="text-lg font-bold text-slate-800">{title}</h3>
            {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
          </div>
          <button
            id={`${id || 'modal'}-close-btn`}
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto flex-1">{children}</div>
      </div>
    </div>
  );
};
