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

import {browserManualServerCipher as cipher} from './browser_manual_server_cipher';
import {
  ManualServerStore,
  LAST_DISPLAYED_SERVER_STORAGE_KEY,
} from './manual_server_store';
import type {ManualServerCipher} from '../model/manual_server_storage';

describe('manual server credential storage', () => {
  // A fake origin and a synthetic input, never a network destination.
  const config = {
    apiUrl: 'https://manager.invalid/test-only-path',
    certSha256: '00',
  };
  const key = 'test-manual-servers';
  let data: Map<string, string>;
  let storage: Storage;
  let warn: jasmine.Spy;

  beforeEach(() => {
    data = new Map();
    storage = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, value: string) => {
        data.set(k, value);
      },
      removeItem: (k: string) => {
        data.delete(k);
      },
    } as Storage;
    warn = jasmine.createSpy('storage warning');
  });

  function open(backend: ManualServerCipher = cipher) {
    return new ManualServerStore(key, backend, warn, storage);
  }

  it('migrates and verifies records and the remembered selection across restart', async () => {
    data.set(key, JSON.stringify([config]));
    data.set(LAST_DISPLAYED_SERVER_STORAGE_KEY, 'manual:' + config.apiUrl);
    const [record] = await open().load();
    expect(record.apiUrl).toBe(config.apiUrl);
    expect(data.get(key)).not.toContain('test-only-path');
    expect(record.id).toMatch(/^manual:[0-9a-f]{32}$/);
    expect(data.get(LAST_DISPLAYED_SERVER_STORAGE_KEY)).toBe(record.id);
    expect(await open().load()).toEqual([record]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('keeps legacy records usable when encryption cannot be verified', async () => {
    const legacy = JSON.stringify([config]);
    data.set(key, legacy);
    const repository = open({seal: cipher.seal, open: async () => []});
    const [record] = await repository.load();
    expect(record.apiUrl).toBe(config.apiUrl);
    expect(warn).toHaveBeenCalled();
    expect(data.get(key)).toBe(legacy);
    await expectAsync(repository.save([record])).toBeRejected();
    expect(data.get(key)).toBe(legacy);
  });

  it('does not overwrite another tab or silently empty a damaged store', async () => {
    const first = open();
    const second = open();
    await Promise.all([first.load(), second.load()]);
    const rows = [{...config, id: 'manual:' + '1'.repeat(32)}];
    await first.save(rows);
    await expectAsync(second.save([])).toBeRejected();
    expect(await open().load()).toEqual(rows);
    data.set(key, 'outline-manual-servers-v1:damaged');
    await expectAsync(open().load()).toBeRejected();
    expect(data.get(key)).toBe('outline-manual-servers-v1:damaged');
  });
});
