/**
 * Universal Firestore Payload Sanitizer & Pre-Write Validation Utility
 * 
 * Guarantees that no `undefined`, `NaN`, `Infinity`, or invalid Date types ever reach
 * Firestore WriteBatch.set(), setDoc(), addDoc(), or updateDoc().
 * 
 * Rules:
 * 1. Omit undefined keys recursively from objects.
 * 2. Preserve explicit null values.
 * 3. Preserve Firestore FieldValue sentinels (serverTimestamp, deleteField, increment, arrayUnion, arrayRemove).
 * 4. Preserve Firestore Timestamps, DocumentReferences, and GeoPoints.
 * 5. Convert or reject NaN / Infinity numbers.
 * 6. Provide deep pre-write validation before batch commits.
 */

import { DocumentReference, CollectionReference, WriteBatch, setDoc, updateDoc, addDoc, SetOptions } from 'firebase/firestore';

/**
 * Check if a value is a special Firestore object that should not be recursively stripped
 */
function isFirestoreSpecialType(val: any): boolean {
  if (!val || typeof val !== 'object') return false;

  // FieldValue sentinel (e.g. serverTimestamp, deleteField, increment)
  if (val._methodName || val.constructor?.name === 'FieldValue' || val.constructor?.name === 'serverTimestampImpl') {
    return true;
  }

  // Firestore Timestamp (has toDate, seconds, nanoseconds)
  if (typeof val.toDate === 'function' && typeof val.seconds === 'number') {
    return true;
  }

  // Firestore DocumentReference (has id, path, firestore)
  if (val.firestore && typeof val.id === 'string' && typeof val.path === 'string') {
    return true;
  }

  // Firestore GeoPoint (has latitude, longitude)
  if (typeof val.latitude === 'number' && typeof val.longitude === 'number') {
    return true;
  }

  return false;
}

/**
 * Recursively sanitizes any payload for Firestore writes.
 * Removes `undefined` keys, validates numbers, and preserves Firestore special types.
 */
export function sanitizeForFirestore<T = any>(data: T): T {
  if (data === undefined) {
    return undefined as unknown as T;
  }

  if (data === null) {
    return null as unknown as T;
  }

  // Primitive non-objects
  if (typeof data !== 'object') {
    if (typeof data === 'number') {
      if (Number.isNaN(data)) {
        return 0 as unknown as T;
      }
      if (!Number.isFinite(data)) {
        return 0 as unknown as T;
      }
    }
    return data;
  }

  // Dates
  if (data instanceof Date) {
    if (isNaN(data.getTime())) {
      return new Date().toISOString() as unknown as T;
    }
    return data;
  }

  // Firestore Special Types (serverTimestamp, FieldValues, References, GeoPoints)
  if (isFirestoreSpecialType(data)) {
    return data;
  }

  // Arrays
  if (Array.isArray(data)) {
    const cleanedArray: any[] = [];
    for (const item of data) {
      if (item !== undefined) {
        const sanitizedItem = sanitizeForFirestore(item);
        if (sanitizedItem !== undefined) {
          cleanedArray.push(sanitizedItem);
        }
      }
    }
    return cleanedArray as unknown as T;
  }

  // Plain Objects
  const cleanedObj: Record<string, any> = {};
  for (const [key, value] of Object.entries(data as Record<string, any>)) {
    if (value === undefined) {
      // Strictly omit undefined fields
      continue;
    }

    const sanitizedVal = sanitizeForFirestore(value);
    if (sanitizedVal !== undefined) {
      cleanedObj[key] = sanitizedVal;
    }
  }

  return cleanedObj as T;
}

export interface ValidationDiagnostic {
  isValid: boolean;
  error?: string;
  field?: string;
  value?: any;
  path?: string;
  collectionName?: string;
  docId?: string;
}

/**
 * Deeply validates a Firestore write payload to guarantee 0% undefined or illegal types.
 */
export function validateFirestorePayload(
  payload: any,
  context?: { collectionName?: string; docId?: string; path?: string }
): ValidationDiagnostic {
  if (payload === undefined) {
    return {
      isValid: false,
      error: `بيانات غير صالحة: القيمة غير معرفة (undefined) في ${context?.collectionName || 'المستند'}.`,
      field: context?.path || 'root',
      value: undefined,
      collectionName: context?.collectionName,
      docId: context?.docId,
    };
  }

  if (payload === null || typeof payload !== 'object') {
    if (typeof payload === 'number' && (Number.isNaN(payload) || !Number.isFinite(payload))) {
      return {
        isValid: false,
        error: `قيمة رقمية غير صالحة (${payload}) في الحقل: ${context?.path || 'root'}.`,
        field: context?.path || 'root',
        value: payload,
        collectionName: context?.collectionName,
        docId: context?.docId,
      };
    }
    return { isValid: true };
  }

  if (isFirestoreSpecialType(payload) || payload instanceof Date) {
    return { isValid: true };
  }

  if (Array.isArray(payload)) {
    for (let i = 0; i < payload.length; i++) {
      const item = payload[i];
      if (item === undefined) {
        return {
          isValid: false,
          error: `مصفوفة تحتوي على عنصر غير معرف (undefined) في الحقل: ${context?.path || 'array'}[${i}].`,
          field: `${context?.path || 'array'}[${i}]`,
          value: undefined,
          collectionName: context?.collectionName,
          docId: context?.docId,
        };
      }
      const itemValidation = validateFirestorePayload(item, {
        ...context,
        path: `${context?.path || 'array'}[${i}]`,
      });
      if (!itemValidation.isValid) {
        return itemValidation;
      }
    }
    return { isValid: true };
  }

  // Inspect Object Keys
  for (const [k, v] of Object.entries(payload)) {
    const currentPath = context?.path ? `${context.path}.${k}` : k;

    if (v === undefined) {
      return {
        isValid: false,
        error: `حقل غير صالح: ${k} = undefined في ${context?.collectionName || 'المستند'}.`,
        field: currentPath,
        value: undefined,
        collectionName: context?.collectionName,
        docId: context?.docId,
      };
    }

    if (typeof v === 'number' && (Number.isNaN(v) || !Number.isFinite(v))) {
      return {
        isValid: false,
        error: `قيمة رقمية غير صالحة في الحقل: ${currentPath} (${v}).`,
        field: currentPath,
        value: v,
        collectionName: context?.collectionName,
        docId: context?.docId,
      };
    }

    if (v instanceof Date && isNaN(v.getTime())) {
      return {
        isValid: false,
        error: `تاريخ غير صالح في الحقل: ${currentPath}.`,
        field: currentPath,
        value: v,
        collectionName: context?.collectionName,
        docId: context?.docId,
      };
    }

    if (typeof v === 'object' && v !== null && !isFirestoreSpecialType(v)) {
      const childValidation = validateFirestorePayload(v, {
        ...context,
        path: currentPath,
      });
      if (!childValidation.isValid) {
        return childValidation;
      }
    }
  }

  return { isValid: true };
}

/**
 * Safe Batch Set Wrapper that automatically sanitizes and validates before setting
 */
export function safeBatchSet<T extends Record<string, any>>(
  batch: WriteBatch,
  docRef: DocumentReference,
  data: T,
  options?: SetOptions
): void {
  const sanitized = sanitizeForFirestore(data);
  const validation = validateFirestorePayload(sanitized, {
    collectionName: docRef.parent?.id || 'collection',
    docId: docRef.id,
  });

  if (!validation.isValid) {
    console.error('Firestore WriteBatch Validation Error:', validation);
    throw new Error(validation.error || `خطأ في صياغة بيانات المستند (${docRef.id}).`);
  }

  if (options) {
    batch.set(docRef, sanitized, options);
  } else {
    batch.set(docRef, sanitized);
  }
}

/**
 * Safe Batch Update Wrapper
 */
export function safeBatchUpdate<T extends Record<string, any>>(
  batch: WriteBatch,
  docRef: DocumentReference,
  data: T
): void {
  const sanitized = sanitizeForFirestore(data);
  const validation = validateFirestorePayload(sanitized, {
    collectionName: docRef.parent?.id || 'collection',
    docId: docRef.id,
  });

  if (!validation.isValid) {
    console.error('Firestore WriteBatch Update Validation Error:', validation);
    throw new Error(validation.error || `خطأ في صياغة تحديث بيانات المستند (${docRef.id}).`);
  }

  batch.update(docRef, sanitized);
}

/**
 * Safe addDoc wrapper
 */
export async function safeAddDoc<T extends Record<string, any>>(
  colRef: CollectionReference,
  data: T
): Promise<DocumentReference> {
  const sanitized = sanitizeForFirestore(data);
  const validation = validateFirestorePayload(sanitized, {
    collectionName: colRef.id,
  });

  if (!validation.isValid) {
    console.error('Firestore addDoc Validation Error:', validation);
    throw new Error(validation.error || `خطأ في صياغة بيانات الإضافة لمجموعة (${colRef.id}).`);
  }

  return await addDoc(colRef, sanitized);
}

/**
 * Safe setDoc wrapper
 */
export async function safeSetDoc<T extends Record<string, any>>(
  docRef: DocumentReference,
  data: T,
  options?: SetOptions
): Promise<void> {
  const sanitized = sanitizeForFirestore(data);
  const validation = validateFirestorePayload(sanitized, {
    collectionName: docRef.parent?.id || 'collection',
    docId: docRef.id,
  });

  if (!validation.isValid) {
    console.error('Firestore setDoc Validation Error:', validation);
    throw new Error(validation.error || `خطأ في صياغة بيانات المستند (${docRef.id}).`);
  }

  if (options) {
    await setDoc(docRef, sanitized, options);
  } else {
    await setDoc(docRef, sanitized);
  }
}

/**
 * Safe updateDoc wrapper
 */
export async function safeUpdateDoc<T extends Record<string, any>>(
  docRef: DocumentReference,
  data: T
): Promise<void> {
  const sanitized = sanitizeForFirestore(data);
  const validation = validateFirestorePayload(sanitized, {
    collectionName: docRef.parent?.id || 'collection',
    docId: docRef.id,
  });

  if (!validation.isValid) {
    console.error('Firestore updateDoc Validation Error:', validation);
    throw new Error(validation.error || `خطأ في صياغة تحديث المستند (${docRef.id}).`);
  }

  await updateDoc(docRef, sanitized);
}
