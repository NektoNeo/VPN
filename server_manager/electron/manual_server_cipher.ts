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

import {ipcMain, safeStorage} from 'electron';
import type {BrowserWindow, IpcMainInvokeEvent} from 'electron';

import {checkManualServers} from '../model/manual_server_storage';

const PREFIX = 'Outline Manager manual servers v1\n';

export function registerManualServerCipher(getWindow: () => BrowserWindow) {
  function requireManager(event: IpcMainInvokeEvent) {
    const contents = getWindow()?.webContents;
    if (
      !contents ||
      event.sender !== contents ||
      event.senderFrame !== contents.mainFrame
    ) {
      throw new Error('Invalid server storage caller');
    }
    const url = new URL(event.senderFrame.url);
    if (
      url.protocol !== 'outline:' ||
      url.host !== 'web_app' ||
      url.pathname !== '/index.html'
    ) {
      throw new Error('Invalid manager document');
    }
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Unlock the operating system credential store');
    }
  }

  ipcMain.handle('seal-manual-servers', (event, entries: unknown) => {
    requireManager(event);
    const plaintext = PREFIX + JSON.stringify(checkManualServers(entries));
    const encrypted = safeStorage.encryptString(plaintext);
    // Chromium on Linux uses v11 with a real keyring. v10 uses a fixed fallback key.
    if (
      process.platform === 'linux' &&
      encrypted.toString('ascii', 0, 3) !== 'v11'
    ) {
      throw new Error('A system keyring is required to store manual servers');
    }
    return encrypted.toString('base64');
  });

  ipcMain.handle('open-manual-servers', (event, ciphertext: string) => {
    requireManager(event);
    if (
      typeof ciphertext !== 'string' ||
      !ciphertext.length ||
      ciphertext.length > 16 * 1024 * 1024
    ) {
      throw new Error('Invalid encrypted manual server record');
    }
    const clear = safeStorage.decryptString(Buffer.from(ciphertext, 'base64'));
    if (!clear.startsWith(PREFIX)) {
      throw new Error('Invalid encrypted manual server record');
    }
    return checkManualServers(JSON.parse(clear.slice(PREFIX.length)));
  });
}
