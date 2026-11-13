// Copyright 2018 The Outline Authors
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

import {hexToString} from '@outline/infrastructure/hex_encoding';

import {makePathApiClient} from './fetcher';
import {ManualServerStore, newManualServerId} from './manual_server_store';
import {ShadowboxServer} from './shadowbox_server';
import type {StoredManualServer} from '../model/manual_server_storage';
import * as server from '../model/server';

class ManualServer extends ShadowboxServer implements server.ManualServer {
  constructor(
    id: string,
    private manualServerConfig: server.ManualServerConfig,
    private forgetCallback: () => Promise<void>
  ) {
    super(id);
    const fingerprint = hexToString(manualServerConfig.certSha256 ?? '');
    this.setManagementApi(
      makePathApiClient(manualServerConfig.apiUrl, fingerprint)
    );
  }

  getCertificateFingerprint() {
    return this.manualServerConfig.certSha256;
  }

  forget(): Promise<void> {
    return this.forgetCallback();
  }
}

export class ManualServerRepository implements server.ManualServerRepository {
  private servers: server.ManualServer[] = [];

  private ready: Promise<void>;
  private writes: Promise<unknown> = Promise.resolve();

  constructor(private store: ManualServerStore) {
    this.ready = this.store.load().then(records => {
      this.servers = records.map(record => this.createServer(record));
    });
  }

  private update<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.writes.then(() => this.ready).then(operation);
    this.writes = next.catch(() => {});
    return next;
  }

  addServer(config: server.ManualServerConfig): Promise<server.ManualServer> {
    return this.update(async () => {
      const existing = this.findServer(config);
      if (existing) {
        return existing;
      }
      const record = {...config, id: newManualServerId()};
      await this.store.save([...this.records(), record]);
      const added = this.createServer(record);
      this.servers.push(added);
      return added;
    });
  }

  async listServers(): Promise<server.ManualServer[]> {
    await this.ready;
    return this.servers.slice();
  }

  findServer(
    config: server.ManualServerConfig
  ): server.ManualServer | undefined {
    return this.servers.find(
      item => item.getManagementApiUrl() === config.apiUrl
    );
  }

  private records(): StoredManualServer[] {
    return this.servers.map(item => ({
      id: item.getId(),
      apiUrl: item.getManagementApiUrl(),
      certSha256: item.getCertificateFingerprint(),
    }));
  }

  private createServer(record: StoredManualServer) {
    return new ManualServer(record.id, record, () =>
      this.update(async () => {
        await this.store.save(
          this.records().filter(item => item.id !== record.id)
        );
        this.servers = this.servers.filter(item => item.getId() !== record.id);
      })
    );
  }
}
