/**
 * Material & Raw Materials Traceability Service
 * Handles CRUD for materials master data and queries material consumption across stages.
 */
import { 
  collection, 
  doc, 
  getDocs, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  query, 
  where, 
  serverTimestamp 
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../config/firebase';
import { Material, MaterialConsumptionItem } from '../types';
import { logAuditAction } from './auditService';
import { enrichWithNormalizedFields, matchesSearch } from '../utils/searchUtils';

export async function fetchMaterials(): Promise<Material[]> {
  try {
    const snapshot = await getDocs(collection(db, 'materials'));
    if (snapshot.empty) {
      // Return default materials if none exist yet
      return [
        { id: 'mat-1', code: 'CHAMOTTE-40', name: 'شاموت 40%', unit: 'طن', category: 'شاموت', active: true },
        { id: 'mat-2', code: 'CHAMOTTE-60', name: 'شاموت 60%', unit: 'طن', category: 'شاموت', active: true },
        { id: 'mat-3', code: 'BAUXITE', name: 'بوكسيت عالي الألومينا', unit: 'طن', category: 'خامات أولية', active: true },
        { id: 'mat-4', code: 'CLAY-PLASTIC', name: 'طين بلاستيكي', unit: 'طن', category: 'رابط', active: true },
        { id: 'mat-5', code: 'SILICA-SAND', name: 'رمل سيليكا مطحون', unit: 'طن', category: 'سيليكا', active: true },
        { id: 'mat-6', code: 'BINDER-LIGNOSULFONATE', name: 'ليجنوسلفونات (رابط عضوي)', unit: 'كجم', category: 'إضافات', active: true },
        { id: 'mat-7', code: 'WATER', name: 'مياه صناعية', unit: 'لتر', category: 'خلط', active: true },
      ];
    }
    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as Material[];
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'materials');
    return [];
  }
}

export async function createMaterial(data: Omit<Material, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
  const enriched = enrichWithNormalizedFields('materials', data);
  try {
    const docRef = await addDoc(collection(db, 'materials'), {
      ...enriched,
      active: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      serverCreatedAt: serverTimestamp(),
      serverUpdatedAt: serverTimestamp(),
    });

    await logAuditAction(
      'CREATE',
      'materials',
      docRef.id,
      `إضافة مادة خام جديدة: ${data.name} (${data.code})`
    );

    return docRef.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, 'materials');
    throw error;
  }
}

export async function updateMaterial(id: string, data: Partial<Material>): Promise<void> {
  const enriched = enrichWithNormalizedFields('materials', data as Record<string, any>);
  try {
    const docRef = doc(db, 'materials', id);
    await updateDoc(docRef, {
      ...enriched,
      updatedAt: new Date().toISOString(),
      serverUpdatedAt: serverTimestamp(),
    });

    await logAuditAction(
      'UPDATE',
      'materials',
      id,
      `تحديث بيانات المادة الخام: ${data.name || id}`
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `materials/${id}`);
    throw error;
  }
}

export async function deleteMaterial(id: string): Promise<void> {
  try {
    const docRef = doc(db, 'materials', id);
    await deleteDoc(docRef);

    await logAuditAction(
      'DELETE',
      'materials',
      id,
      `حذف المادة الخام: ${id}`
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `materials/${id}`);
    throw error;
  }
}

export async function toggleMaterialActive(id: string, currentStatus: boolean): Promise<void> {
  await updateMaterial(id, { active: !currentStatus });
}

