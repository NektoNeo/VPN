// Copyright 2026 The Outline Authors
// SPDX-License-Identifier: Apache-2.0

import {
  checkManualServers,
  ManualServerCipher,
} from '../model/manual_server_storage';

// The browser build runs on localhost / HTTPS and has no Electron keychain.
// IndexedDB can persist a non-extractable CryptoKey using structured clone.
async function browserKey(create: boolean): Promise<CryptoKey> {
  const candidate = create
    ? await crypto.subtle.generateKey({name: 'AES-GCM', length: 256}, false, [
        'encrypt',
        'decrypt',
      ])
    : undefined;
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('outline-manager-credentials', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('keys');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise<CryptoKey>((resolve, reject) => {
      // A single read/write transaction makes concurrent first-run tabs agree on a key.
      const tx = db.transaction('keys', create ? 'readwrite' : 'readonly');
      const store = tx.objectStore('keys');
      const request = store.get('manual-servers');
      let key: CryptoKey;
      request.onsuccess = () => {
        key = request.result;
        if (!key && candidate) {
          key = candidate;
          store.add(key, 'manual-servers');
        }
      };
      tx.onabort = () =>
        reject(tx.error ?? new Error('Key storage unavailable'));
      tx.oncomplete = () =>
        key ? resolve(key) : reject(new Error('Missing server storage key'));
    });
  } finally {
    db.close();
  }
}

export const browserManualServerCipher: ManualServerCipher = {
  async seal(records) {
    const key = await browserKey(true);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
      {name: 'AES-GCM', iv},
      key,
      new TextEncoder().encode(JSON.stringify(checkManualServers(records)))
    );
    const bytes = new Uint8Array(iv.length + encrypted.byteLength);
    bytes.set(iv);
    bytes.set(new Uint8Array(encrypted), iv.length);
    return btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''));
  },
  async open(ciphertext) {
    const key = await browserKey(false);
    const bytes = Uint8Array.from(atob(ciphertext), char => char.charCodeAt(0));
    const cleartext = await crypto.subtle.decrypt(
      {name: 'AES-GCM', iv: bytes.slice(0, 12)},
      key,
      bytes.slice(12)
    );
    return checkManualServers(JSON.parse(new TextDecoder().decode(cleartext)));
  },
};
