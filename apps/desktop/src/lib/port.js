import net from 'node:net';

/**
 * Ask the operating system for an unused TCP port on `host`.
 *
 * Binding to port 0 and reading the assigned port is the only reliable way to
 * avoid the "port already in use" race that a fixed default would create.
 */
export function findFreePort(host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, host, () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      server.close(() => {
        if (!port) reject(new Error('could not allocate a free port'));
        else resolve(port);
      });
    });
  });
}

/** Check whether a specific port can be bound right now. */
export function isPortFree(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', () => resolve(false));
    server.listen(port, host, () => server.close(() => resolve(true)));
  });
}
