/* ─────────────────────────────────────────────────────────────
   store.js — 持久化层
   首选 IndexedDB（可申请持久配额，不会被当成「会话缓存」优先清理），
   同时镜像一份到 localStorage，任何一侧读失败都能回退。
   写入只来自用户操作，代码里没有任何自动清理路径。
   ───────────────────────────────────────────────────────────── */

const DB_NAME = 'yeobaek';
const DB_VER = 1;
const STORE = 'kv';
const MIRROR_PREFIX = 'yb:';
const MEM = new Map();

let dbp = null;

function openDb() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('no-idb'));
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('idb-blocked'));
  }).catch((err) => {
    console.warn('[store] IndexedDB 不可用，改用内存镜像', err);
    return null;
  });
  return dbp;
}

async function idbGet(key) {
  const db = await openDb();
  if (!db) return MEM.has(key) ? MEM.get(key) : undefined;
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(undefined);
  });
}

async function idbSet(key, value) {
  const db = await openDb();
  MEM.set(key, value);
  if (!db) return;
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

async function idbDel(key) {
  const db = await openDb();
  MEM.delete(key);
  if (!db) return;
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
  });
}

function mirrorWrite(key, value) {
  try { localStorage.setItem(MIRROR_PREFIX + key, JSON.stringify(value)); } catch {}
}

function mirrorRead(key) {
  try {
    const raw = localStorage.getItem(MIRROR_PREFIX + key);
    return raw == null ? undefined : JSON.parse(raw);
  } catch { return undefined; }
}

export async function get(key, fallback) {
  let v = await idbGet(key);
  if (v === undefined) v = mirrorRead(key);
  if (v === undefined) return fallback;
  return v;
}

export async function set(key, value) {
  mirrorWrite(key, value);
  await idbSet(key, value);
  return value;
}

export async function remove(key) {
  try { localStorage.removeItem(MIRROR_PREFIX + key); } catch {}
  await idbDel(key);
}

/* ── 迁移：把早期 localStorage-only 版本收进来 ─────────────── */
export async function migrateLegacy() {
  const keys = ['favs', 'cats', 'tabs', 'recent', 'settings'];
  for (const k of keys) {
    const legacy = mirrorRead(k);
    if (legacy !== undefined) {
      const current = await idbGet(k);
      if (current === undefined) await idbSet(k, legacy);
    }
  }
}

/* ── 配额 ─────────────────────────────────────────────────── */
export async function storageEstimate() {
  if (!navigator.storage?.estimate) return null;
  try {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    return { usage, quota };
  } catch { return null; }
}

export async function isPersisted() {
  if (!navigator.storage?.persisted) return null;
  try { return await navigator.storage.persisted(); } catch { return null; }
}

export async function requestPersist() {
  if (!navigator.storage?.persist) return null;
  try { return await navigator.storage.persist(); } catch { return null; }
}

export function fmtBytes(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0, v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${u[i]}`;
}
