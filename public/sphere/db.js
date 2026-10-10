/* IndexedDB の薄いラッパー：points / circles / links / media */
const DB = (() => {
  const NAME = 'sphere-app', VER = 1;
  let dbp = null;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(NAME, VER);
      r.onupgradeneeded = () => {
        const d = r.result;
        for (const s of ['points', 'circles', 'links', 'media']) {
          if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: 'id' });
        }
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  function tx(store, mode, fn) {
    return open().then(d => new Promise((res, rej) => {
      const t = d.transaction(store, mode);
      const req = fn(t.objectStore(store));
      t.oncomplete = () => res(req && req.result);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    }));
  }
  return {
    all: (s) => tx(s, 'readonly', st => st.getAll()),
    get: (s, id) => tx(s, 'readonly', st => st.get(id)),
    put: (s, obj) => tx(s, 'readwrite', st => st.put(obj)),
    del: (s, id) => tx(s, 'readwrite', st => st.delete(id)),
    clear: (s) => tx(s, 'readwrite', st => st.clear()),
    putMany: (s, arr) => tx(s, 'readwrite', st => { arr.forEach(o => st.put(o)); }),
  };
})();
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
