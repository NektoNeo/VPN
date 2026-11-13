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
