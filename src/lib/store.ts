/**
 * In-memory store replacing Firebase Firestore and Firebase Storage.
 * Exports a Firestore-compatible API so all existing page code works unchanged
 * (only the import path needs to change from 'firebase/firestore' to '../lib/store').
 *
 * Data is held in module-level Maps and survives React re-renders but is
 * cleared on full page reload — intentional for a self-contained demo.
 */

// ==================== TYPES ====================

export interface Timestamp {
  toDate: () => Date;
  seconds: number;
  nanoseconds: number;
}

export interface DocumentData {
  [key: string]: any;
}

export interface QueryDocumentSnapshot {
  id: string;
  exists: () => boolean;
  data: () => DocumentData;
}

export interface QuerySnapshot {
  docs: QueryDocumentSnapshot[];
  size: number;
  empty: boolean;
  forEach: (callback: (doc: QueryDocumentSnapshot) => void) => void;
}

export interface CollectionReference {
  __type: 'collection';
  path: string;
}

export interface DocumentReference {
  __type: 'doc';
  id: string;
  path: string;
  collectionPath: string;
}

export interface QueryConstraint {
  __constraintType: 'where' | 'orderBy' | 'limit';
  field?: string;
  op?: string;
  value?: any;
  direction?: 'asc' | 'desc';
  count?: number;
}

export interface StoreQuery {
  __type: 'query';
  collectionPath: string;
  constraints: QueryConstraint[];
}

// ==================== INTERNAL STATE ====================

const _collections = new Map<string, Map<string, DocumentData>>();
const _listeners = new Map<string, Set<() => void>>();
const _fileStorage = new Map<string, string>(); // storagePath → data URL

const STORE_COLLECTIONS_KEY = 'cpfbfd2026.store.collections';
const STORE_FILES_KEY = 'cpfbfd2026.store.files';
let _storageSyncInitialized = false;

function canUseBrowserStorage(): boolean {
  return typeof window !== 'undefined' && !!window.localStorage;
}

function reviveTimestampLike(value: any): any {
  if (Array.isArray(value)) {
    return value.map(reviveTimestampLike);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  const obj: any = { ...value };
  if (
    typeof obj.seconds === 'number' &&
    typeof obj.nanoseconds === 'number' &&
    typeof obj.toDate !== 'function'
  ) {
    obj.toDate = () => new Date(obj.seconds * 1000 + obj.nanoseconds / 1_000_000);
  }

  for (const key of Object.keys(obj)) {
    obj[key] = reviveTimestampLike(obj[key]);
  }

  return obj;
}

function persistStateToLocalStorage() {
  if (!canUseBrowserStorage()) return;

  const collectionsObj: Record<string, Record<string, DocumentData>> = {};
  for (const [collectionPath, docs] of _collections.entries()) {
    collectionsObj[collectionPath] = {};
    for (const [docId, docData] of docs.entries()) {
      collectionsObj[collectionPath][docId] = docData;
    }
  }

  const filesObj: Record<string, string> = {};
  for (const [storagePath, dataUrl] of _fileStorage.entries()) {
    filesObj[storagePath] = dataUrl;
  }

  window.localStorage.setItem(STORE_COLLECTIONS_KEY, JSON.stringify(collectionsObj));
  window.localStorage.setItem(STORE_FILES_KEY, JSON.stringify(filesObj));
}

function hydrateStateFromLocalStorage() {
  if (!canUseBrowserStorage()) return;

  const rawCollections = window.localStorage.getItem(STORE_COLLECTIONS_KEY);
  const rawFiles = window.localStorage.getItem(STORE_FILES_KEY);

  _collections.clear();
  _fileStorage.clear();

  if (rawCollections) {
    try {
      const parsed = JSON.parse(rawCollections) as Record<string, Record<string, DocumentData>>;
      for (const [collectionPath, docsObj] of Object.entries(parsed)) {
        const docsMap = new Map<string, DocumentData>();
        for (const [docId, docData] of Object.entries(docsObj || {})) {
          docsMap.set(docId, reviveTimestampLike(docData));
        }
        _collections.set(collectionPath, docsMap);
      }
    } catch {
      // Ignore malformed persisted state and continue with empty store.
    }
  }

  if (rawFiles) {
    try {
      const parsed = JSON.parse(rawFiles) as Record<string, string>;
      for (const [storagePath, dataUrl] of Object.entries(parsed)) {
        _fileStorage.set(storagePath, dataUrl);
      }
    } catch {
      // Ignore malformed persisted files and continue with empty file storage.
    }
  }
}

function notifyAllListeners() {
  for (const collectionPath of _listeners.keys()) {
    notifyListeners(collectionPath);
  }
}

function initializeStorageSync() {
  if (_storageSyncInitialized || !canUseBrowserStorage()) return;

  hydrateStateFromLocalStorage();

  window.addEventListener('storage', (event) => {
    if (event.key !== STORE_COLLECTIONS_KEY && event.key !== STORE_FILES_KEY) return;
    hydrateStateFromLocalStorage();
    notifyAllListeners();
  });

  _storageSyncInitialized = true;
}

initializeStorageSync();

function getCollection(path: string): Map<string, DocumentData> {
  if (!_collections.has(path)) {
    _collections.set(path, new Map());
  }
  return _collections.get(path)!;
}

function applyConstraints(
  docs: QueryDocumentSnapshot[],
  constraints: QueryConstraint[]
): QueryDocumentSnapshot[] {
  let result = [...docs];

  for (const c of constraints) {
    if (c.__constraintType === 'where') {
      result = result.filter((snap) => {
        const val = snap.data()[c.field!];
        switch (c.op) {
          case '==': return val === c.value;
          case '!=': return val !== c.value;
          case '>': return val > c.value;
          case '<': return val < c.value;
          case '>=': return val >= c.value;
          case '<=': return val <= c.value;
          case 'in': return Array.isArray(c.value) && c.value.includes(val);
          case 'not-in': return Array.isArray(c.value) && !c.value.includes(val);
          default: return true;
        }
      });

    } else if (c.__constraintType === 'orderBy') {
      const dir = c.direction ?? 'asc';
      result.sort((a, b) => {
        const aVal = a.data()[c.field!];
        const bVal = b.data()[c.field!];
        // Support Timestamp objects (compare by .seconds)
        const aComp = aVal?.seconds !== undefined ? aVal.seconds : aVal;
        const bComp = bVal?.seconds !== undefined ? bVal.seconds : bVal;
        if (aComp === bComp) return 0;
        if (aComp == null) return dir === 'asc' ? 1 : -1;
        if (bComp == null) return dir === 'asc' ? -1 : 1;
        return dir === 'asc' ? (aComp < bComp ? -1 : 1) : (aComp > bComp ? -1 : 1);
      });

    } else if (c.__constraintType === 'limit') {
      result = result.slice(0, c.count);
    }
  }

  return result;
}

function buildSnapshot(
  collectionPath: string,
  constraints: QueryConstraint[] = []
): QuerySnapshot {
  const coll = getCollection(collectionPath);
  let docs: QueryDocumentSnapshot[] = Array.from(coll.entries()).map(
    ([id, data]) => ({
      id,
      exists: () => true,
      data: () => ({ ...data }),
    })
  );

  docs = applyConstraints(docs, constraints);

  return {
    docs,
    size: docs.length,
    empty: docs.length === 0,
    forEach: (cb) => docs.forEach(cb),
  };
}

function notifyListeners(collectionPath: string) {
  _listeners.get(collectionPath)?.forEach((cb) => cb());
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// ==================== PUBLIC FIRESTORE API ====================

/** Dummy database object — matches the shape passed around by callers. */
export const db = {};

export function collection(_db: any, path: string): CollectionReference {
  return { __type: 'collection', path };
}

export function doc(
  dbOrRef: any,
  pathOrId?: string,
  id?: string
): DocumentReference {
  // Signature 1: doc(db, 'CollectionName', 'docId')
  if (id !== undefined) {
    return {
      __type: 'doc',
      id,
      path: `${pathOrId}/${id}`,
      collectionPath: pathOrId!,
    };
  }

  // Signature 2: doc(collRef, 'docId')  or  doc(collRef)  → auto ID
  if (dbOrRef?.__type === 'collection') {
    const autoId = pathOrId ?? generateId();
    return {
      __type: 'doc',
      id: autoId,
      path: `${dbOrRef.path}/${autoId}`,
      collectionPath: dbOrRef.path,
    };
  }

  throw new Error('doc(): unsupported argument signature');
}

export function query(
  ref: CollectionReference,
  ...constraints: QueryConstraint[]
): StoreQuery {
  return {
    __type: 'query',
    collectionPath: ref.path,
    constraints,
  };
}

export function where(
  field: string,
  op: string,
  value: any
): QueryConstraint {
  return { __constraintType: 'where', field, op, value };
}

export function orderBy(
  field: string,
  direction: 'asc' | 'desc' = 'asc'
): QueryConstraint {
  return { __constraintType: 'orderBy', field, direction };
}

export function limit(count: number): QueryConstraint {
  return { __constraintType: 'limit', count };
}

export function serverTimestamp(): Timestamp {
  const now = new Date();
  return {
    toDate: () => now,
    seconds: Math.floor(now.getTime() / 1000),
    nanoseconds: (now.getTime() % 1000) * 1_000_000,
  };
}

export async function getDocs(
  ref: CollectionReference | StoreQuery
): Promise<QuerySnapshot> {
  const collPath = ref.__type === 'query' ? ref.collectionPath : ref.path;
  const constraints = ref.__type === 'query' ? ref.constraints : [];
  return buildSnapshot(collPath, constraints);
}

export function onSnapshot(
  ref: CollectionReference | StoreQuery,
  callback: (snap: QuerySnapshot) => void
): () => void {
  const collPath = ref.__type === 'query' ? ref.collectionPath : ref.path;
  const constraints = ref.__type === 'query' ? ref.constraints : [];

  if (!_listeners.has(collPath)) {
    _listeners.set(collPath, new Set());
  }

  const listener = () => callback(buildSnapshot(collPath, constraints));
  _listeners.get(collPath)!.add(listener);

  // Fire immediately (async to match Firebase behaviour)
  setTimeout(listener, 0);

  return () => _listeners.get(collPath)?.delete(listener);
}

export async function setDoc(
  ref: DocumentReference,
  data: DocumentData,
  options?: { merge?: boolean }
): Promise<void> {
  initializeStorageSync();
  const coll = getCollection(ref.collectionPath);
  if (options?.merge && coll.has(ref.id)) {
    coll.set(ref.id, { ...coll.get(ref.id), ...data });
  } else {
    coll.set(ref.id, { ...data });
  }
  persistStateToLocalStorage();
  notifyListeners(ref.collectionPath);
}

export async function addDoc(
  ref: CollectionReference,
  data: DocumentData
): Promise<DocumentReference> {
  initializeStorageSync();
  const id = generateId();
  getCollection(ref.path).set(id, { ...data });
  persistStateToLocalStorage();
  notifyListeners(ref.path);
  return {
    __type: 'doc',
    id,
    path: `${ref.path}/${id}`,
    collectionPath: ref.path,
  };
}

export function writeBatch(_db: any) {
  initializeStorageSync();
  const ops: Array<{
    type: 'set' | 'update' | 'delete';
    ref: DocumentReference;
    data?: DocumentData;
    options?: { merge?: boolean };
  }> = [];

  const batch = {
    set(ref: DocumentReference, data: DocumentData, options?: { merge?: boolean }) {
      ops.push({ type: 'set', ref, data, options });
      return batch;
    },
    update(ref: DocumentReference, data: DocumentData) {
      ops.push({ type: 'update', ref, data });
      return batch;
    },
    delete(ref: DocumentReference) {
      ops.push({ type: 'delete', ref });
      return batch;
    },
    async commit() {
      const affected = new Set<string>();
      for (const op of ops) {
        const coll = getCollection(op.ref.collectionPath);
        if (op.type === 'set') {
          if (op.options?.merge && coll.has(op.ref.id)) {
            coll.set(op.ref.id, { ...coll.get(op.ref.id), ...op.data });
          } else {
            coll.set(op.ref.id, { ...op.data! });
          }
        } else if (op.type === 'update') {
          if (coll.has(op.ref.id)) {
            coll.set(op.ref.id, { ...coll.get(op.ref.id), ...op.data });
          }
        } else if (op.type === 'delete') {
          coll.delete(op.ref.id);
        }
        affected.add(op.ref.collectionPath);
      }
      persistStateToLocalStorage();
      affected.forEach(notifyListeners);
    },
  };

  return batch;
}

// ==================== PUBLIC STORAGE API ====================

/** Dummy storage object — passed to ref() but ignored internally. */
export const storage = {};

export interface StorageReference {
  __type: 'storageRef';
  path: string;
}

/** Creates a storage reference (mirrors firebase/storage `ref`). */
export function ref(_storage: any, path: string): StorageReference {
  return { __type: 'storageRef', path };
}

export interface UploadTaskSnapshot {
  bytesTransferred: number;
  totalBytes: number;
}

/**
 * Reads the file via FileReader, stores it as a base64 data URL in memory,
 * then fires the progress / complete callbacks — matching the Firebase API.
 */
export function uploadBytesResumable(storageRef: StorageReference, file: File) {
  initializeStorageSync();
  let _onProgress: ((snap: UploadTaskSnapshot) => void) | null = null;
  let _onError: ((err: Error) => void) | null = null;
  let _onComplete: (() => void) | null = null;

  const task = {
    on(
      _event: string,
      onProgress: (snap: UploadTaskSnapshot) => void,
      onError: (err: Error) => void,
      onComplete: () => void
    ) {
      _onProgress = onProgress;
      _onError = onError;
      _onComplete = onComplete;

      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string;
        _fileStorage.set(storageRef.path, dataUrl);
        persistStateToLocalStorage();
        _onProgress?.({ bytesTransferred: file.size, totalBytes: file.size });
        _onComplete?.();
      };
      reader.onerror = () => {
        _onError?.(new Error('Failed to read file into memory'));
      };
      reader.readAsDataURL(file);
    },
    /** Exposed so PrizeSetup can call getDownloadURL(uploadTask.snapshot.ref) */
    snapshot: { ref: storageRef },
  };

  return task;
}

/** Returns the base64 data URL previously stored for this path. */
export async function getDownloadURL(storageRef: StorageReference): Promise<string> {
  const dataUrl = _fileStorage.get(storageRef.path);
  if (!dataUrl) throw new Error(`No file stored at path: ${storageRef.path}`);
  return dataUrl;
}
