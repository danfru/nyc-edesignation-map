const DB_NAME = 'edesig_cache'
const DB_VERSION = 1
const STORE = 'data'
const CACHE_TTL = 24 * 60 * 60 * 1000 // 24 hours

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = e => e.target.result.createObjectStore(STORE)
    req.onsuccess = e => resolve(e.target.result)
    req.onerror = () => reject(req.error)
  })
}

export async function cacheGet(key) {
  try {
    const db = await openDB()
    return new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get(key)
      req.onsuccess = () => {
        const val = req.result
        if (!val) return resolve(null)
        if (Date.now() - val.ts > CACHE_TTL) return resolve(null)
        resolve(val.data)
      }
      req.onerror = () => resolve(null)
    })
  } catch (_) { return null }
}

export async function cacheSet(key, data) {
  try {
    const db = await openDB()
    return new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put({ data, ts: Date.now() }, key)
      tx.oncomplete = resolve
      tx.onerror = resolve
    })
  } catch (_) {}
}

export async function cacheClear() {
  try {
    const db = await openDB()
    return new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).clear()
      tx.oncomplete = resolve
      tx.onerror = resolve
    })
  } catch (_) {}
}
