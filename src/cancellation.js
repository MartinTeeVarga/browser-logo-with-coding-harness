export function stoppedError() {
  const error = new Error('Stopped. Your code is preserved.');
  error.name = 'AbortError';
  return error;
}

export function throwIfAborted(signal) {
  if (signal?.aborted) throw signal.reason || stoppedError();
}

// Stop waiting even if an SDK ignores AbortSignal. Late results are discarded;
// the underlying promise still has a rejection handler to avoid stray errors.
export function waitForResult(promise, signal) {
  if (!signal) return Promise.resolve(promise);
  return new Promise((resolve, reject) => {
    function cleanup() { signal.removeEventListener('abort', abort); }
    function abort() { cleanup(); reject(signal.reason || stoppedError()); }
    Promise.resolve(promise).then(
      value => {cleanup(); resolve(value);},
      error => {cleanup(); reject(error);}
    );
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, {once:true});
  });
}
