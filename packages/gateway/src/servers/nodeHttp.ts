import { promises as fsPromises } from 'node:fs';
import { createServer as createHTTPServer, type Server } from 'node:http';
import { createServer as createHTTPSServer } from 'node:https';
import type { SecureContextOptions } from 'node:tls';
import type { GatewayRuntime } from '@graphql-hive/gateway-runtime';
import { createAsyncDisposable } from '@graphql-mesh/utils';
import { defaultOptions } from '../cli';
import { getGraphQLWSOptions } from './graphqlWs';
import type { ServerForRuntimeOptions } from './types';

export async function startNodeHttpServer<TContext extends Record<string, any>>(
  gwRuntime: GatewayRuntime<TContext>,
  opts: ServerForRuntimeOptions,
): Promise<AsyncDisposable> {
  const {
    log,
    host = defaultOptions.host,
    port = defaultOptions.port,
    sslCredentials,
    maxHeaderSize,
    disableWebsockets,
  } = opts;
  let server: Server;
  let protocol: string;

  if (sslCredentials) {
    protocol = 'https';
    const sslOptionsForNodeHttp: SecureContextOptions = {};
    if (sslCredentials.ca_file_name) {
      sslOptionsForNodeHttp.ca = await fsPromises.readFile(
        sslCredentials.ca_file_name,
      );
    }
    if (sslCredentials.cert_file_name) {
      sslOptionsForNodeHttp.cert = await fsPromises.readFile(
        sslCredentials.cert_file_name,
      );
    }
    if (sslCredentials.dh_params_file_name) {
      sslOptionsForNodeHttp.dhparam = await fsPromises.readFile(
        sslCredentials.dh_params_file_name,
      );
    }
    if (sslCredentials.key_file_name) {
      sslOptionsForNodeHttp.key = await fsPromises.readFile(
        sslCredentials.key_file_name,
      );
    }
    if (sslCredentials.passphrase) {
      sslOptionsForNodeHttp.passphrase = sslCredentials.passphrase;
    }
    if (sslCredentials.ssl_ciphers) {
      sslOptionsForNodeHttp.ciphers = sslCredentials.ssl_ciphers;
    }
    if (sslCredentials.ssl_prefer_low_memory_usage) {
      sslOptionsForNodeHttp.honorCipherOrder = true;
    }
    server = createHTTPSServer(
      {
        ...sslOptionsForNodeHttp,
        maxHeaderSize,
      },
      gwRuntime,
    );
  } else {
    protocol = 'http';
    server = createHTTPServer(
      {
        maxHeaderSize,
      },
      gwRuntime,
    );
  }

  const url = `${protocol}://${host}:${port}`.replace('0.0.0.0', 'localhost');

  log.debug(`Starting server on ${url}`);
  if (!disableWebsockets) {
    log.debug('Setting up WebSocket server');
    const { WebSocketServer } = await import('ws');
    const wsServer = new WebSocketServer({
      path: gwRuntime.graphqlEndpoint,
      server,
    });
    const { useServer } = await import('graphql-ws/lib/use/ws');

    useServer(getGraphQLWSOptions(gwRuntime), wsServer);
  }
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      log.info(`Listening on ${url}`);
      resolve(
        createAsyncDisposable(
          () =>
            new Promise<void>((resolve) => {
              process.stderr.write('\n');
              log.info(`Stopping the server`);
              server.closeAllConnections();
              server.close(() => {
                log.info(`Stopped the server successfully`);
                resolve();
              });
            }),
        ),
      );
    });
  });
}