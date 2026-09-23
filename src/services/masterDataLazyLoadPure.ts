/**
 * Master Data on-demand loading rules.
 *
 * THE RULE: the Master Data screen reads nothing until the user opens a
 * section. Opening the screen used to select Products automatically, which
 * subscribed to the whole products collection, seeded and subscribed to the
 * product types, read every equipment collection, the cost-centre hierarchy and
 * two dropdown lists - before the user had asked for anything at all. On a
 * large database that is tens of thousands of document reads for a screen the
 * user may have opened to reach one record in a different section.
 *
 * These rules are pure so they can be asserted directly: `plannedEntityReads`
 * for the mount state returns an EMPTY list, which is the property the screen
 * has to have. The screen imports these functions rather than repeating the
 * conditions, so the two cannot drift apart.
 *
 * WHAT THIS IS NOT: it changes nothing about what a section contains, who may
 * read or write it, how it is validated, or how the importers work. It decides
 * only WHEN a read is allowed to happen.
 */
import { MasterDataCategory, subCategories } from './masterDataCategoryRegistry';

/** The parts of the screen's state that decide what may be read. */
export interface MasterDataScreenState {
  /**
   * The section the user has opened. `null` is the state the screen mounts in
   * and the reason nothing is read then.
   */
  activeCategoryId: string | null;
  /** The tab engine's value - only meaningful once a section is open. */
  activeTab: string;
  /** The reconciliation window, which compares every equipment category. */
  isReconcileOpen: boolean;
  /** The Add/Edit form, which owns the two dropdown lists. */
  isModalOpen: boolean;
}

/**
 * The section actually open, as a tab id.
 *
 * Derived from the chosen category rather than from `activeTab`, because the
 * tab follows the category one render later: reading from `activeTab` would
 * make one click read the previous section's collection first and the chosen
 * one immediately after. A group category (Equipment) keeps whichever of its
 * own tabs is already open, which is the existing navigation behaviour.
 */
export function resolveOpenTab(
  state: Pick<MasterDataScreenState, 'activeCategoryId' | 'activeTab'>,
  navigation: readonly MasterDataCategory[],
): string | null {
  if (state.activeCategoryId === null) return null;
  const category = navigation.find((c) => c.id === state.activeCategoryId);
  if (!category?.tab) return null;
  if (category.subCategoryIds) {
    const groupTabs = subCategories(category.id).map((sc) => sc.tab);
    return groupTabs.includes(state.activeTab) ? state.activeTab : category.tab;
  }
  return category.tab;
}

/**
 * Product types are needed by the Products parser and prefix filter, and by the
 * Product Types section itself. Nothing else uses them, and subscribing also
 * triggers the initial seed - so a user who opens neither section must not pay
 * for that collection.
 */
export function shouldSubscribeProductTypes(openTab: string | null): boolean {
  return openTab === 'products' || openTab === 'productTypes';
}

/**
 * The equipment reference data - the cost-centre hierarchy nodes the link
 * selector offers, and every equipment record the reconciliation compares.
 * Needed while an equipment section is open, or while the reconciliation window
 * is; never merely because the screen is on screen.
 */
export function needsEquipmentReferenceData(
  openTab: string | null,
  isReconcileOpen: boolean,
  isEquipmentTab: (tab: string) => boolean,
): boolean {
  if (isReconcileOpen) return true;
  return openTab !== null && isEquipmentTab(openTab);
}

/**
 * The two lists a form field offers: a department for an employee, a furnace
 * for a furnace car. Read when that form opens, for the section that offers the
 * dropdown - not when the screen opens.
 */
export function formDropdownCollections(openTab: string | null, isModalOpen: boolean): string[] {
  if (!isModalOpen) return [];
  if (openTab === 'employees') return ['departments'];
  if (openTab === 'furnaceCars') return ['furnaces'];
  return [];
}

/** What the screen should do for the section now on display. */
export interface SectionLoadPlan {
  /** The collection to subscribe to, or `null` when nothing may be read. */
  read: string | null;
  /** Rows already in hand are shown instead of being read again. */
  reuse: boolean;
  /** Whether the loading indicator belongs on screen. */
  loading: boolean;
}

/**
 * Whether opening this section costs a read.
 *
 * A section already opened keeps its live listener, so returning to it is free:
 * the rows are already held and still updating. A section never opened, or one
 * whose listener the explicit Refresh has just detached, is read.
 */
export function planSectionLoad(input: {
  /** The section's collection, or `null` when no section is open. */
  collectionName: string | null;
  /** A live listener for this section is already attached. */
  hasListener: boolean;
  /** Rows for this section are already held. */
  hasRows: boolean;
}): SectionLoadPlan {
  if (!input.collectionName) return { read: null, reuse: false, loading: false };
  if (input.hasListener) return { read: null, reuse: true, loading: false };
  return { read: input.collectionName, reuse: input.hasRows, loading: !input.hasRows };
}

/** The collections a given screen state is allowed to read, with nothing loaded yet. */
export function plannedEntityReads(
  state: MasterDataScreenState,
  navigation: readonly MasterDataCategory[],
  options: {
    /** The collection a tab reads - the existing MASTER_DATA_COLLECTIONS map. */
    collectionFor: (tab: string) => string | undefined;
    /** Every equipment collection the reconciliation compares. */
    equipmentCollections: readonly string[];
    /** The cost-centre hierarchy collection. */
    hierarchyCollection: string;
    /** Which tabs can carry a hierarchy link - the existing predicate. */
    isEquipmentTab: (tab: string) => boolean;
  },
): string[] {
  const openTab = resolveOpenTab(state, navigation);
  const reads: string[] = [];
  const add = (name: string | undefined) => {
    if (name && !reads.includes(name)) reads.push(name);
  };

  if (openTab) add(options.collectionFor(openTab));
  if (shouldSubscribeProductTypes(openTab)) add('productTypes');
  if (needsEquipmentReferenceData(openTab, state.isReconcileOpen, options.isEquipmentTab)) {
    add(options.hierarchyCollection);
    options.equipmentCollections.forEach(add);
  }
  formDropdownCollections(openTab, state.isModalOpen).forEach(add);
  return reads;
}
