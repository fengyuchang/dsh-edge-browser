import net from 'node:net';
import { randomUUID } from 'node:crypto';

// Human-only preview transport. Model tools keep the upstream CLI and its receipts.
export function createPreviewTransport(discover) {
  let address, expires = 0, pendingDiscovery;
  const live = new Set();
  const result = (code, body, aborted = false) => ({ code, stdout: JSON.stringify(body), stderr: '', timedOut: code === 4, aborted });
  const failure = (code, message) => ({ code, message });
  const socketPath = async () => {
    if (address && Date.now() < expires) return address;
    pendingDiscovery ??= Promise.resolve().then(discover).then(status => {
      if (status.protocol_version !== '1.8') throw new Error('Preview requires the coordinated BrowserSkill 1.8 protocol');
      const path = status.sock_path;
      if (typeof path !== 'string' || (process.platform === 'win32' ? !path.startsWith('\\\\.\\pipe\\bsk-daemon-') : !path.startsWith('/'))) throw new Error('Invalid local BrowserSkill socket');
      address = path; expires = Date.now() + 10000; return path;
    }).finally(() => { pendingDiscovery = undefined; });
    return pendingDiscovery;
  };
  function rpc(path, method, params, id, timeout = 8000, onWritten) {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ path });
      socket.setEncoding('utf8');
      let chunks = '', bytes = 0, settled = false;
      const finish = (error, value) => {
        if (settled) return; settled = true; clearTimeout(timer); socket.destroy();
        error ? reject(error) : resolve(value);
      };
      const timer = setTimeout(() => finish(new Error('Preview IPC timed out')), timeout);
      socket.once('connect', () => {
        socket.write(JSON.stringify({ id, method, params }) + '\n');
        onWritten?.();
      });
      socket.on('data', chunk => {
        bytes += Buffer.byteLength(chunk);
        if (bytes > 16 * 1024 * 1024) { finish(new Error('Preview exceeds 16 MiB')); return; }
        chunks += chunk.toString('utf8');
        const end = chunks.indexOf('\n'); if (end < 0) return;
        try {
          const frame = JSON.parse(chunks.slice(0, end));
          if (frame.id !== id || (!!frame.error === ('result' in frame))) throw new Error('Invalid preview IPC response');
          finish(undefined, frame);
        } catch (error) { finish(error); }
      });
      socket.once('error', error => finish(error));
      socket.once('end', () => finish(new Error('Preview IPC closed without a receipt')));
    });
  }
  return {
    async capture(sessionId, options = {}) {
      if (typeof sessionId !== 'string' || !sessionId) return result(3, failure('invalid_params', 'Preview requires an owned session'));
      const state = { tag: options.tag, aborted: false, written: false, done: false, cancel: undefined };
      live.add(state);
      let timer, abort;
      try {
        const path = await socketPath(), id = randomUUID();
        const cancel = () => {
          state.aborted = true;
          if (!state.written || state.cancel) return;
          state.cancel = (async () => {
            const deadline = Date.now() + 1800;
            while (!state.done && Date.now() < deadline) {
              const reply = await rpc(path, 'cancel', { rpc_id: id }, randomUUID(), 400).catch(() => undefined);
              if (reply?.result?.cancelled) return;
              await new Promise(resolve => setTimeout(resolve, 40));
            }
          })();
        };
        state.abort = cancel;
        abort = () => cancel();
        options.signal?.addEventListener('abort', abort, { once: true });
        if (state.aborted || options.signal?.aborted) return result(1, failure('cancelled', 'Preview cancelled before dispatch'), true);
        timer = setTimeout(cancel, Math.min(options.timeoutMs ?? 6000, 6000));
        const frame = await rpc(path, 'tool.screenshot', { session_id: sessionId, dsh_preview: true }, id, 8500, () => { state.written = true; if (state.aborted) cancel(); });
        if (state.aborted) return result(1, failure('cancelled', 'Preview cancelled'), true);
        if (frame.error) return result(3, frame.error);
        const image = frame.result;
        if (image?.dsh_preview !== true || typeof image.image_base64 !== 'string' || !image.image_base64.startsWith('iVBORw0KGgo') || image.format !== 'png' || !Number.isSafeInteger(image.tab_id) || ![image.width, image.height].every(n => Number.isSafeInteger(n) && n > 0 && n <= 16384)) throw new Error('Extension did not acknowledge a valid human-only preview');
        return result(0, image);
      } catch (error) {
        expires = 0;
        return result(state.aborted ? 1 : 3, failure(state.aborted ? 'cancelled' : 'cdp_failed', error.message), state.aborted);
      } finally {
        state.done = true; clearTimeout(timer); options.signal?.removeEventListener('abort', abort); live.delete(state);
        await state.cancel;
      }
    },
    killFor(tag) { let count = 0; for (const state of live) if (state.tag === tag && !state.aborted) { state.aborted = true; state.abort?.(); count++; } return count; },
    dispose() { for (const state of live) { state.aborted = true; state.abort?.(); } },
  };
}
