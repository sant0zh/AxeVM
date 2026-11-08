export type StoredAssetBinary = {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  blob: Blob;
};

const DATABASE_NAME = 'axevm-assets';
const DATABASE_VERSION = 1;
const OBJECT_STORE = 'asset-binaries';

let databasePromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB is not available in this browser.'));
  }

  if (!databasePromise) {
    databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(OBJECT_STORE)) {
          database.createObjectStore(OBJECT_STORE, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => database.close();
        resolve(database);
      };
      request.onerror = () => reject(request.error ?? new Error('Could not open the asset store.'));
      request.onblocked = () => reject(new Error('The asset store is blocked by another open AxeVM tab.'));
    }).catch((error: unknown) => {
      databasePromise = null;
      throw error;
    });
  }

  return databasePromise;
}

function transactionError(transaction: IDBTransaction): Error {
  return transaction.error ?? new Error('The asset storage transaction failed.');
}

/** Binary asset bytes live in IndexedDB; VM metadata remains in the workspace repository. */
export const assetBinaryStorage = {
  async putMany(assets: readonly StoredAssetBinary[]): Promise<void> {
    if (assets.length === 0) return;
    const database = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(OBJECT_STORE, 'readwrite');
      const store = transaction.objectStore(OBJECT_STORE);
      for (const asset of assets) store.put(asset);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transactionError(transaction));
      transaction.onabort = () => reject(transactionError(transaction));
    });
  },

  async get(id: string): Promise<StoredAssetBinary | null> {
    const database = await openDatabase();
    return new Promise<StoredAssetBinary | null>((resolve, reject) => {
      const transaction = database.transaction(OBJECT_STORE, 'readonly');
      const request = transaction.objectStore(OBJECT_STORE).get(id);
      request.onsuccess = () => resolve((request.result as StoredAssetBinary | undefined) ?? null);
      request.onerror = () => reject(request.error ?? new Error('Could not read the stored asset.'));
      transaction.onabort = () => reject(transactionError(transaction));
    });
  },

  async removeMany(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    const database = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(OBJECT_STORE, 'readwrite');
      const store = transaction.objectStore(OBJECT_STORE);
      for (const id of ids) store.delete(id);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transactionError(transaction));
      transaction.onabort = () => reject(transactionError(transaction));
    });
  },

  async download(id: string): Promise<void> {
    const asset = await this.get(id);
    if (!asset) throw new Error('The binary file is not present in browser storage.');

    const url = URL.createObjectURL(asset.blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = asset.name;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};
