export interface LocalPhotoRef {
  id: string;
  name: string;
  mimeType: string;
  size: number;
}

const DATABASE_NAME = 'gala-nanaman-media';
const STORE_NAME = 'activity-photos';
const DATABASE_VERSION = 1;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open local photo storage.'));
  });
}

export async function saveLocalPhoto(file: File): Promise<LocalPhotoRef> {
  if (navigator.storage?.estimate) {
    const { usage = 0, quota } = await navigator.storage.estimate();
    if (quota && usage + file.size > quota) throw new Error('Not enough local storage space for this photo.');
  }
  if (navigator.storage?.persisted && navigator.storage?.persist && !(await navigator.storage.persisted())) {
    await navigator.storage.persist().catch(() => false);
  }

  const id = globalThis.crypto?.randomUUID?.() ?? `photo-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const reference: LocalPhotoRef = { id, name: file.name.slice(0, 120), mimeType: file.type, size: file.size };
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put({ ...reference, blob: file });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('Could not save this photo on the device.'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Could not save this photo on the device.'));
    });
    return reference;
  } finally {
    database.close();
  }
}

export async function loadLocalPhoto(id: string): Promise<Blob | undefined> {
  const database = await openDatabase();
  try {
    return await new Promise<Blob | undefined>((resolve, reject) => {
      const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(id);
      request.onsuccess = () => resolve(request.result?.blob as Blob | undefined);
      request.onerror = () => reject(request.error ?? new Error('Could not read the local photo.'));
    });
  } finally {
    database.close();
  }
}

export async function deleteLocalPhoto(id: string): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).delete(id);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('Could not remove the local photo.'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Could not remove the local photo.'));
    });
  } finally {
    database.close();
  }
}
