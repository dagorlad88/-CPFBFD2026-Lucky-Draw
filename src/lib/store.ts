/**
 * Host-backed data store.
 *
 * Exposes a Firestore-compatible API (the same surface the pages already
 * import) but persists everything to the shared backend in server.js, which
 * stores it in a SQLite file. This means ALL users see and maintain the SAME
 * data — uploads, prize changes and draw results are no longer trapped in one
 * browser's localStorage.
 *
 * Reads are cached in-memory per collection so query constraints and snapshot
 * building stay synchronous; the cache is refreshed on every getDocs() and
 * whenever the server pushes a change over Server-Sent Events.
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

const API_BASE = '/api';

/** Client-side cache of the server data, keyed by collection path. */
const _cache = new Map<string, Map<string, DocumentData>>();
const _listeners = new Map<string, Set<() => void>>();
let _eventSource: EventSource | null = null;

function getCacheCollection(path: string): Map<string, DocumentData> {
  if (!_cache.has(path)) _cache.set(path, new Map());
  return _cache.get(path)!;
}

/** Re-attaches a `.toDate()` method to plain {seconds, nanoseconds} objects. */
function reviveTimestampLike(value: any): any {
  if (Array.isArray(value)) return value.map(reviveTimestampLike);
  if (!value || typeof value !== 'object') return value;

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

async function apiFetch(pathAndQuery: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${API_BASE}${pathAndQuery}`, init);
  if (!res.ok && res.status !== 404) {
    let detail = '';
    try {
      const body = await res.clone().json();
      detail = body?.error ? `: ${body.error}` : '';
    } catch {
      /* ignore */
    }
    throw new Error(`Request failed (${res.status})${detail}`);
  }
  return res;
}

/** Fetches a collection from the server and refreshes the local cache. */
async function fetchCollection(path: string): Promise<Map<string, DocumentData>> {
  const res = await apiFetch(`/collections/${encodeURIComponent(path)}`);
  const json = (await res.json()) as { docs: Array<{ id: string; data: DocumentData }> };
  const map = new Map<string, DocumentData>();
  for (const { id, data } of json.docs) {
    map.set(id, reviveTimestampLike(data));
  }
  _cache.set(path, map);
  return map;
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
  const coll = _cache.get(collectionPath) ?? new Map<string, DocumentData>();
  let docs: QueryDocumentSnapshot[] = Array.from(coll.entries()).map(([id, data]) => ({
    id,
    exists: () => true,
    data: () => ({ ...data }),
  }));

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

/** Opens the SSE connection once; refreshes affected collections on change. */
function ensureEventSource() {
  if (_eventSource || typeof window === 'undefined' || typeof EventSource === 'undefined') {
    return;
  }
  _eventSource = new EventSource(`${API_BASE}/events`);
  _eventSource.onmessage = (event) => {
    try {
      const { collections } = JSON.parse(event.data) as { collections?: string[] };
      for (const path of collections ?? []) {
        if ((_listeners.get(path)?.size ?? 0) > 0) {
          fetchCollection(path)
            .then(() => notifyListeners(path))
            .catch(() => { /* keep last known data */ });
        }
      }
    } catch {
      /* ignore malformed events */
    }
  };
  // The browser reconnects automatically on error; nothing to do here.
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

  // Signature 2: doc(collRef, 'docId') or doc(collRef) -> auto ID
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
  return { __type: 'query', collectionPath: ref.path, constraints };
}

export function where(field: string, op: string, value: any): QueryConstraint {
  return { __constraintType: 'where', field, op, value };
}

export function orderBy(field: string, direction: 'asc' | 'desc' = 'asc'): QueryConstraint {
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
  await fetchCollection(collPath);
  return buildSnapshot(collPath, constraints);
}

export function onSnapshot(
  ref: CollectionReference | StoreQuery,
  callback: (snap: QuerySnapshot) => void
): () => void {
  const collPath = ref.__type === 'query' ? ref.collectionPath : ref.path;
  const constraints = ref.__type === 'query' ? ref.constraints : [];

  if (!_listeners.has(collPath)) _listeners.set(collPath, new Set());

  const listener = () => callback(buildSnapshot(collPath, constraints));
  _listeners.get(collPath)!.add(listener);

  ensureEventSource();

  // Initial load, then fire once with whatever we have.
  fetchCollection(collPath)
    .then(() => listener())
    .catch(() => listener());

  return () => _listeners.get(collPath)?.delete(listener);
}

function applyLocalSet(
  collectionPath: string,
  id: string,
  data: DocumentData,
  merge?: boolean
) {
  const coll = getCacheCollection(collectionPath);
  if (merge && coll.has(id)) {
    coll.set(id, { ...coll.get(id), ...data });
  } else {
    coll.set(id, { ...data });
  }
}

export async function setDoc(
  ref: DocumentReference,
  data: DocumentData,
  options?: { merge?: boolean }
): Promise<void> {
  await apiFetch(
    `/collections/${encodeURIComponent(ref.collectionPath)}/${encodeURIComponent(ref.id)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data, merge: !!options?.merge }),
    }
  );
  applyLocalSet(ref.collectionPath, ref.id, data, options?.merge);
  notifyListeners(ref.collectionPath);
}

export async function addDoc(
  ref: CollectionReference,
  data: DocumentData
): Promise<DocumentReference> {
  const res = await apiFetch(`/collections/${encodeURIComponent(ref.path)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data }),
  });
  const { id } = (await res.json()) as { id: string };
  applyLocalSet(ref.path, id, data, false);
  notifyListeners(ref.path);
  return {
    __type: 'doc',
    id,
    path: `${ref.path}/${id}`,
    collectionPath: ref.path,
  };
}

export function writeBatch(_db: any) {
  const ops: Array<{
    type: 'set' | 'update' | 'delete';
    collection: string;
    id: string;
    data?: DocumentData;
    merge?: boolean;
  }> = [];

  const batch = {
    set(ref: DocumentReference, data: DocumentData, options?: { merge?: boolean }) {
      ops.push({ type: 'set', collection: ref.collectionPath, id: ref.id, data, merge: !!options?.merge });
      return batch;
    },
    update(ref: DocumentReference, data: DocumentData) {
      ops.push({ type: 'update', collection: ref.collectionPath, id: ref.id, data });
      return batch;
    },
    delete(ref: DocumentReference) {
      ops.push({ type: 'delete', collection: ref.collectionPath, id: ref.id });
      return batch;
    },
    async commit() {
      if (ops.length === 0) return;
      await apiFetch('/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ops }),
      });

      const affected = new Set<string>();
      for (const op of ops) {
        const coll = getCacheCollection(op.collection);
        if (op.type === 'set') {
          if (op.merge && coll.has(op.id)) coll.set(op.id, { ...coll.get(op.id), ...op.data });
          else coll.set(op.id, { ...op.data! });
        } else if (op.type === 'update') {
          if (coll.has(op.id)) coll.set(op.id, { ...coll.get(op.id), ...op.data });
        } else if (op.type === 'delete') {
          coll.delete(op.id);
        }
        affected.add(op.collection);
      }
      affected.forEach(notifyListeners);
      ops.length = 0;
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
 * Reads the file via FileReader, uploads it as a base64 data URL to the host,
 * then fires the progress / complete callbacks — matching the Firebase API.
 */
export function uploadBytesResumable(storageRef: StorageReference, file: File) {
  const task = {
    on(
      _event: string,
      onProgress: (snap: UploadTaskSnapshot) => void,
      onError: (err: Error) => void,
      onComplete: () => void
    ) {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const dataUrl = e.target?.result as string;
        try {
          await apiFetch('/files', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: storageRef.path, dataUrl }),
          });
          onProgress?.({ bytesTransferred: file.size, totalBytes: file.size });
          onComplete?.();
        } catch (err) {
          onError?.(err as Error);
        }
      };
      reader.onerror = () => onError?.(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    },
    /** Exposed so PrizeSetup can call getDownloadURL(uploadTask.snapshot.ref) */
    snapshot: { ref: storageRef },
  };

  return task;
}

/** Returns the base64 data URL previously stored for this path. */
export async function getDownloadURL(storageRef: StorageReference): Promise<string> {
  const res = await apiFetch(`/files?path=${encodeURIComponent(storageRef.path)}`);
  if (res.status === 404) throw new Error(`No file stored at path: ${storageRef.path}`);
  const { dataUrl } = (await res.json()) as { dataUrl: string };
  return dataUrl;
}
