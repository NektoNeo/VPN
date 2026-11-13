// Copyright 2026 The Outline Authors
// SPDX-License-Identifier: Apache-2.0

import type {ManualServerConfig} from './server';

export interface StoredManualServer extends ManualServerConfig {
  id: string;
}

export interface ManualServerCipher {
  seal(records: StoredManualServer[]): Promise<string>;
  open(ciphertext: string): Promise<StoredManualServer[]>;
}

// Validate both the Electron IPC boundary and data restored from disk.
export function checkManualServers(value: unknown): StoredManualServer[] {
  if (
    !Array.isArray(value) ||
    !value.every(
      row =>
        row &&
        typeof row.apiUrl === 'string' &&
        row.apiUrl.length > 0 &&
        (row.certSha256 === undefined || typeof row.certSha256 === 'string') &&
        typeof row.id === 'string' &&
        /^manual:[0-9a-f]{32}$/.test(row.id)
    ) ||
    new Set(value.map(row => row.id)).size !== value.length
  ) {
    throw new Error('Invalid stored manual server records');
  }
  return value.map(({id, apiUrl, certSha256}) => ({id, apiUrl, certSha256}));
}
