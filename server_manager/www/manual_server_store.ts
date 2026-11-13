// Copyright 2026 The Outline Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import {
  checkManualServers,
  ManualServerCipher,
  StoredManualServer,
} from '../model/manual_server_storage';

export const LAST_DISPLAYED_SERVER_STORAGE_KEY = 'lastDisplayedServer';
const STORAGE_PREFIX = 'outline-manual-servers-v1:';

export class ManualServerStorageError extends Error {
  constructor() {
    super('Could not read or write saved manual servers.');
  }
}

export function newManualServerId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return (
    'manual:' +
    Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  );
}

export class ManualServerStore {
  private snapshot: string | null;

  constructor(
    private key: string,
    private cipher: ManualServerCipher,
    private reportError: () => void,
    private storage: Storage = localStorage
  ) {}

  async load(): Promise<StoredManualServer[]> {
    try {
      return await this.readRecords();
    } catch {
      throw new ManualServerStorageError();
    }
  }

  private async readRecords(): Promise<StoredManualServer[]> {
    const previous = this.storage.getItem(this.key);
    this.snapshot = previous;
    if (previous === null) {
      this.restoreSelection([]);
      return [];
    }
    if (previous.startsWith(STORAGE_PREFIX)) {
      const records = checkManualServers(
        await this.cipher.open(previous.slice(STORAGE_PREFIX.length))
      );
      this.restoreSelection(records);
      return records;
    }

    const legacy = JSON.parse(previous);
    if (!Array.isArray(legacy)) {
      throw new Error('Invalid legacy manual server list');
    }
    const records = checkManualServers(
      legacy.map(row => ({...row, id: newManualServerId()}))
    );
    try {
      await this.save(records);
    } catch {
      // Keep the only durable copy and let the user manage already configured
      // servers while the keyring is locked. Subsequent writes must encrypt.
      this.reportError();
    }
    return records;
  }

  async save(records: StoredManualServer[]): Promise<void> {
    try {
      await this.replaceRecords(records);
    } catch {
      throw new ManualServerStorageError();
    }
  }

  private async replaceRecords(records: StoredManualServer[]) {
    const canonical = checkManualServers(records);
    const ciphertext = await this.cipher.seal(canonical);
    const recovered = checkManualServers(await this.cipher.open(ciphertext));
    if (JSON.stringify(recovered) !== JSON.stringify(canonical)) {
      throw new Error('Failed to verify encrypted server records');
    }
    const replace = () => {
      if (this.storage.getItem(this.key) !== this.snapshot) {
        throw new Error('Stored manual servers changed. Reopen the manager.');
      }
      const next = STORAGE_PREFIX + ciphertext;
      // setItem replaces the single old value atomically, including on quota errors.
      this.storage.setItem(this.key, next);
      this.snapshot = next;
      this.restoreSelection(canonical);
    };
    if (navigator.locks) {
      await navigator.locks.request('outline-manager-manual-servers', replace);
    } else {
      replace();
    }
  }

  private restoreSelection(records: StoredManualServer[]) {
    const selected = this.storage.getItem(LAST_DISPLAYED_SERVER_STORAGE_KEY);
    if (
      !selected?.startsWith('manual:') ||
      /^manual:[0-9a-f]{32}$/.test(selected)
    ) {
      return;
    }
    const match = records.find(
      server => 'manual:' + server.apiUrl === selected
    );
    if (match) {
      this.storage.setItem(LAST_DISPLAYED_SERVER_STORAGE_KEY, match.id);
    } else {
      this.storage.removeItem(LAST_DISPLAYED_SERVER_STORAGE_KEY);
    }
  }
}
