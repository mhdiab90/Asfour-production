/**
 * Master Data browsing - one screen of rows, search, and "load everything" on request.
 *
 * THE RULE: opening a section reads ONE SCREEN of records, not the collection.
 * 3.21.6 stopped the screen reading anything before a section was chosen, but
 * choosing Products still attached a listener to the whole products collection
 * - every document, every visit - and rendered all of them into the table. On a
 * database with tens of thousands of products, BOMs and materials that is a long
 * wait and a large read for a user who usually wants one record.
 *
 * So a section now opens with:
 *   - one page of records (about a screenful, `pageSizeForViewport`), read with
 *     a limited query ordered by document id - the same order the full listener
 *     delivered, so nothing moves around;
 *   - the total count, from a server-side count aggregation (it reads no
 *     documents);
 *   - a search box that asks the SERVER for matching records, so a record that
 *     is not on the first page is still found without loading the collection;
 *   - "Load more" for the next page, and "Load all data" - the previous
 *     behaviour, a live listener on the whole collection - only when the user
 *     asks for it.
 *
 * WHAT THE SERVER CAN AND CANNOT SEARCH: Firestore has no "contains" query. The
 * server search matches the START of the code or name (a range query), in the
 * case typed, upper case and lower case. Matching ANY part of the code, or any
 * other field, needs the records in hand - which is exactly what "Load all data"
 * provides, after which the existing local search matches anywhere, as before.
 * The screen says so rather than pretending a prefix search is a full one.
 *
 * WHAT STILL LOADS EVERYTHING, AND WHY: a hierarchy (financial accounts, cost
 * centres) cannot be shown one page at a time - a node's path needs its
 * parents - and a few small reference lists are cheaper whole. Saving in a
 * section whose validation compares against every record (a duplicate code, a
 * second active default, a parent cycle) loads the full list first, so no
 * validation is weakened: it sees exactly the list it always saw.
 *
 * Nothing here reads or writes; the screen and masterDataService do. These
 * rules are pure so they can be asserted directly.
 */

/** The fewest rows a page holds, however short the window. */
export const PAGE_SIZE_MIN = 20;
/** The most rows a page holds, however tall the window. */
export const PAGE_SIZE_MAX = 50;
/** The approximate height of one table row, used to fit a page to the window. */
export const TABLE_ROW_HEIGHT_PX = 40;
/** A search runs on the server from this many characters. */
export const SEARCH_MIN_LENGTH = 2;
/** The pause after the last keystroke before the server is asked. */
export const SEARCH_DEBOUNCE_MS = 400;
/** The most records one server search query returns. */
export const SEARCH_LIMIT_PER_QUERY = 50;
/** A page, count or search request that has not answered by then is reported, not waited on forever. */
export const BROWSE_FETCH_TIMEOUT_MS = 30_000;
/** How long a save waits for the full list its validation needs before it refuses. */
export const FULL_LIST_WAIT_MS = 60_000;

/**
 * Sections that always load their whole list: small reference lists whose
 * whole purpose is to be seen together (product types feed the code parser,
 * operations are a short fixed set).
 */
export const FULL_LIST_TABS: readonly string[] = ['productTypes', 'stages'];

/**
 * Sections whose SAVE validation compares the record against every other one
 * in the collection - duplicate codes, a single active default per scope, a
 * parent that must exist and must not close a cycle. Their save loads the full
 * list first; every other section's save goes through the shared service's own
 * duplicate lookup and never needed the list.
 */
export const SAVE_NEEDS_FULL_LIST_TABS: readonly string[] = [
  'financialAccounts',
  'stages',
  'tubeBallMills',
  'bunkers',
  'rotaryKilns',
  'jobReferences',
  'batches',
  'boms',
  'routings',
];

export type SectionBrowseMode = 'PAGED' | 'FULL';

/** The category facts this module needs - a subset of MasterDataCategory. */
export interface BrowseCategory {
  hierarchical?: boolean;
  searchFields?: readonly string[];
  codeField?: string;
}

/**
 * How many rows make one screen.
 *
 * The window's height divided by a row's height, kept between PAGE_SIZE_MIN and
 * PAGE_SIZE_MAX, so a small laptop and a tall monitor both see a full screen
 * without the page being a hidden bulk read.
 */
export function pageSizeForViewport(viewportHeight: number | null | undefined): number {
  const h = Number(viewportHeight);
  if (!Number.isFinite(h) || h <= 0) return PAGE_SIZE_MIN;
  const rows = Math.ceil(h / TABLE_ROW_HEIGHT_PX);
  return Math.min(PAGE_SIZE_MAX, Math.max(PAGE_SIZE_MIN, rows));
}

/** Whether a section opens one page at a time, or whole. */
export function sectionBrowseMode(tab: string, category: BrowseCategory | undefined): SectionBrowseMode {
  if (category?.hierarchical) return 'FULL';
  if (FULL_LIST_TABS.includes(tab)) return 'FULL';
  return 'PAGED';
}

/** Whether saving in this section needs every record of it first. */
export function saveNeedsFullList(tab: string): boolean {
  return SAVE_NEEDS_FULL_LIST_TABS.includes(tab);
}

/**
 * The forms of a search term the server is asked for.
 *
 * Firestore compares strings exactly, so "bar25" does not find "BAR25". Codes
 * are mostly upper case and names mixed, so the term is tried as typed, in
 * upper case and in lower case - at most three forms, duplicates removed.
 * Below SEARCH_MIN_LENGTH characters nothing is sent: one character matches a
 * large share of any collection, which is the bulk read this exists to avoid.
 */
export function searchTermVariants(term: string | null | undefined): string[] {
  const t = String(term ?? '').trim();
  if (t.length < SEARCH_MIN_LENGTH) return [];
  return [...new Set([t, t.toUpperCase(), t.toLowerCase()])];
}

/** The fields the server search matches the start of - the category's own search fields. */
export function serverSearchFields(category: BrowseCategory | undefined): string[] {
  const fields = category?.searchFields?.length ? [...category.searchFields] : [];
  if (category?.codeField && !fields.includes(category.codeField)) fields.unshift(category.codeField);
  if (fields.length === 0) fields.push('code', 'name');
  return [...new Set(fields)];
}

/**
 * Whether the search box should ask the server.
 *
 * Not when the whole list is already in hand - the local search then matches
 * anywhere in any field, which is strictly better - and not for a term too
 * short to be selective, unless a filter (the product prefix) narrows it.
 */
export function shouldSearchServer(input: {
  mode: SectionBrowseMode;
  fullLoaded: boolean;
  term: string;
  equalsFilter: string | null;
}): boolean {
  if (input.mode === 'FULL' || input.fullLoaded) return false;
  return searchTermVariants(input.term).length > 0 || Boolean(input.equalsFilter);
}

/** Rows from several reads, each record once, in the order first seen. */
export function mergeRowsById<T extends { id?: unknown }>(...lists: ReadonlyArray<readonly T[] | null | undefined>): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const list of lists) {
    for (const row of list ?? []) {
      const id = String(row?.id ?? '');
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(row);
    }
  }
  return out;
}

/** Replaces a record in place, or adds it at the top when it is new. */
export function upsertRowById<T extends { id?: unknown }>(rows: readonly T[], row: T): T[] {
  const id = String(row?.id ?? '');
  if (!id) return [...rows];
  const index = rows.findIndex((r) => String(r?.id ?? '') === id);
  if (index < 0) return [row, ...rows];
  const next = [...rows];
  next[index] = row;
  return next;
}

/** Drops a record. */
export function removeRowById<T extends { id?: unknown }>(rows: readonly T[], id: string): T[] {
  return rows.filter((r) => String(r?.id ?? '') !== id);
}

/**
 * The records in hand for the open section.
 *
 * The full list when it has been loaded - the local search and filters then
 * work over everything, exactly as before. Otherwise the pages read so far,
 * with the server's search results in front while a search is active; the
 * existing local filter then keeps only the matches from both.
 */
export function browseRows<T extends { id?: unknown }>(input: {
  fullRows: readonly T[] | null;
  pageRows: readonly T[];
  searchRows: readonly T[];
  searchActive: boolean;
}): T[] {
  if (input.fullRows) return [...input.fullRows];
  return input.searchActive ? mergeRowsById(input.searchRows, input.pageRows) : [...input.pageRows];
}

/** What the "more" control under the table does next. */
export type MoreAction = 'SHOW_MORE' | 'FETCH_PAGE' | 'NONE';

/**
 * Rows already in hand are shown first (no read); only when every row in hand
 * is on screen does "more" ask the server for the next page - and never while
 * a search is active, since a search result is not a page of the collection.
 */
export function moreAction(input: {
  rendered: number;
  available: number;
  fullLoaded: boolean;
  pageExhausted: boolean;
  searchActive: boolean;
}): MoreAction {
  if (input.rendered < input.available) return 'SHOW_MORE';
  if (input.fullLoaded || input.searchActive || input.pageExhausted) return 'NONE';
  return 'FETCH_PAGE';
}

/** Whether a server read came back cut off at its limit - more matches may exist. */
export function isTruncated(returned: number, limit: number): boolean {
  return limit > 0 && returned >= limit;
}
