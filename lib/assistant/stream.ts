import { friendlyApiError } from '@/lib/apiErrors';

// Streams newline-delimited JSON events to the browser for the lifetime of one request. Closing
// the request (the Stop button aborts the fetch) aborts the signal, which cancels the model call.
// PORT NOTE: Node res.writeHead/res.write -> a ReadableStream Response with the same headers and
// lines. The old res 'close' (client disconnect mid-stream) -> req.signal 'abort' / stream cancel.
export function streamNdjson(req: Request, work: (emit: (event: any) => void, signal: AbortSignal) => Promise<any>): Response {
  const controller = new AbortController();
  const encoder = new TextEncoder();
  let finished = false;
  let closed = false;

  const stream = new ReadableStream({
    async start(sc) {
      // Fires when the client disconnects mid-stream.
      const onAbort = () => {
        if (!finished) controller.abort();
      };
      if (req.signal.aborted) onAbort();
      else req.signal.addEventListener('abort', onAbort);

      const emit = (event: any) => {
        if (closed) return;
        try {
          sc.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
        } catch {
          closed = true;
        }
      };

      try {
        await work(emit, controller.signal);
        emit({ type: 'done' });
      } catch (err) {
        if (controller.signal.aborted) {
          emit({ type: 'stopped' });
        } else {
          console.error(err);
          emit({ type: 'error', error: friendlyApiError(err) });
        }
      } finally {
        finished = true;
        req.signal.removeEventListener('abort', onAbort);
        if (!closed) {
          closed = true;
          try {
            sc.close();
          } catch {
            // already closed
          }
        }
      }
    },
    cancel() {
      closed = true;
      if (!finished) controller.abort();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
