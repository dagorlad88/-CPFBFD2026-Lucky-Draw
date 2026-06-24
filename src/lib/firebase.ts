/**
 * Firebase has been replaced by an in-memory store.
 * Re-export db and storage stubs from the local store so all existing
 * `import { db, storage } from '../../lib/firebase'` lines keep working.
 */
export { db, storage } from './store';
