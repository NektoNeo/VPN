// Copyright 2022 The Outline Authors
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

import * as crypto from 'crypto';
import * as https from 'https';
import {AddressInfo} from 'net';

import * as forge from 'node-forge';

import {fetchWithPin} from './fetch';

describe('fetchWithPin', () => {
  // Make a certificate.
  const {privateKey, publicKey} = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = publicKey;
  cert.sign(privateKey); // Self-signed cert

  // Serialize the certificate for `tls.createServer()`.
  const keyPem = forge.pki.privateKeyToPem(privateKey);
  const certPem = forge.pki.certificateToPem(cert);

  // Compute the certificate fingerprint.
  const certDer = forge.pki.pemToDer(certPem);
  const sha256 = crypto.createHash('sha256');
  const certSha256 = sha256
    .update(certDer.data, 'binary')
    .digest()
    .toString('binary');

  it('refuses to send HTTP data to a server with the wrong pin', async () => {
    const server = https.createServer({key: keyPem, cert: certPem}, () =>
      fail('HTTP reached a server with the wrong pin')
    );
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve)
    );
    const {port} = server.address() as AddressInfo;
    try {
      const result = fetchWithPin(
        {url: `https://127.0.0.1:${port}/foo`, method: 'POST', body: 'test'},
        'incorrect fingerprint'
      );
      await expectAsync(result).toBeRejectedWithError(
        Error,
        /Fingerprint mismatch/
      );
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('succeeds on pin match', async () => {
    const server = https.createServer({key: keyPem, cert: certPem});
    await new Promise<void>((fulfill) =>
      server.listen(0, '127.0.0.1', fulfill)
    );

    const address = server.address() as AddressInfo;
    const req = {
      url: `https://127.0.0.1:${address.port}/foo`,
      method: 'GET',
    };
    server.on('request', (incoming, response) => {
      expect(incoming.url).toBe('/foo');
      expect(incoming.method).toBe('GET');
      response.writeHead(200);
      response.write('test test');
      response.end();
    });

    const result = fetchWithPin(req, certSha256);
    try {
      await expectAsync(result).toBeResolvedTo({
        status: 200,
        body: 'test test',
      });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
