// IndexedDB によるローカル保存（プロフィール／対局記録）。ブラウザ専用。
const DB_NAME = "reversi";
const DB_VERSION = 1;
export const MAX_PROFILES = 2;

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("profiles")) {
        db.createObjectStore("profiles", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("games")) {
        db.createObjectStore("games", { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null; // 失敗をキャッシュせず再試行可能にする
      reject(req.error);
    };
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(store, mode);
        const s = t.objectStore(store);
        const result = fn(s);
        t.oncomplete = () => resolve(result.value !== undefined ? result.value : result);
        t.onerror = () => reject(t.error);
      })
  );
}

function reqResult(request) {
  const box = {};
  request.onsuccess = () => { box.value = request.result; };
  return box;
}

// --- プロフィール（上限2人） ---
export function listProfiles() {
  return tx("profiles", "readonly", (s) => reqResult(s.getAll()));
}

export async function addProfile(name) {
  const list = await listProfiles();
  if (list.length >= MAX_PROFILES) {
    throw new Error(`プロフィールは最大${MAX_PROFILES}人までです`);
  }
  const profile = { id: crypto.randomUUID(), name };
  await tx("profiles", "readwrite", (s) => reqResult(s.add(profile)));
  return profile;
}

export function updateProfile(id, name) {
  return tx("profiles", "readwrite", (s) => reqResult(s.put({ id, name })));
}

export function deleteProfile(id) {
  return tx("profiles", "readwrite", (s) => reqResult(s.delete(id)));
}

// --- 対局記録 ---
export function addGame(record) {
  return tx("games", "readwrite", (s) => reqResult(s.add(record)));
}

export function listGames() {
  return tx("games", "readonly", (s) => reqResult(s.getAll()));
}
