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

import type {IncomingMessage} from 'http';
import * as https from 'https';
import {isIP} from 'net';
import {connect} from 'tls';
import {urlToHttpOptions} from 'url';

import type {HttpRequest, HttpResponse} from '@outline/infrastructure/path_api';

export const fetchWithPin = async (
  req: HttpRequest,
  fingerprint: string
): Promise<HttpResponse> => {
  const url = new URL(req.url);
  if (url.protocol !== 'https:') {
    throw new Error('Pinned requests require HTTPS');
  }

  // The server may have a self-signed certificate. Establish a fresh TLS
  // connection and verify the configured SHA-256 pin before HTTP sees it.
  const response = await new Promise<IncomingMessage>((resolve, reject) => {
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const options: https.RequestOptions = {
      ...urlToHttpOptions(url),
      method: req.method,
      headers: req.headers,
      createConnection: (_options, ready) => {
        const socket = connect({
          host,
          port: Number(url.port || 443),
          servername: isIP(host) ? undefined : host,
          rejectUnauthorized: false,
        });
        const fail = (error: Error) => {
          socket.destroy();
          ready(error, undefined);
        };
        socket.once('error', fail);
        socket.once('secureConnect', () => {
          const peer = socket.getPeerCertificate();
          const actual = peer.fingerprint256?.replace(/:/g, '');
          if (
            !actual ||
            Buffer.from(actual, 'hex').toString('binary') !== fingerprint
          ) {
            fail(new Error('Fingerprint mismatch'));
            return;
          }
          socket.removeListener('error', fail);
          ready(null, socket);
        });
        // Returning the socket here would let HTTP send data before pinning.
        return undefined;
      },
    };
    const request = https.request(options, resolve).on('error', reject);

    if (req.body) {
      request.write(req.body);
    }

    request.end();
  });

  const chunks: Buffer[] = [];
  for await (const chunk of response) {
    chunks.push(chunk);
  }

  return {
    status: response.statusCode,
    body: Buffer.concat(chunks).toString(),
  };
};
