// Sessions and videos stay on the device (IndexedDB). Nothing is uploaded.

const DB_NAME = 'bppv-assistant';
let dbp;

function db() {
  dbp ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      d.createObjectStore('sessions', { keyPath: 'id' });
      d.createObjectStore('videos', { keyPath: 'id' }).createIndex('session', 'sessionId');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const r = fn(t.objectStore(store));
    t.oncomplete = () => resolve(r?.result);
    t.onerror = () => reject(t.error);
  });
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export const saveSession = (s) => tx('sessions', 'readwrite', (st) => st.put(s));
export const getSession = (id) => tx('sessions', 'readonly', (st) => st.get(id));
export async function listSessions() {
  const all = (await tx('sessions', 'readonly', (st) => st.getAll())) || [];
  return all.sort((a, b) => b.created - a.created);
}

export const saveVideo = (v) => tx('videos', 'readwrite', (st) => st.put(v));
export const getVideo = (id) => tx('videos', 'readonly', (st) => st.get(id));

export async function deleteSession(id) {
  const s = await getSession(id);
  for (const vid of s?.videoIds || []) await tx('videos', 'readwrite', (st) => st.delete(vid));
  await tx('sessions', 'readwrite', (st) => st.delete(id));
}

export async function persist() {
  try {
    return await navigator.storage?.persist?.();
  } catch {
    return false;
  }
}
