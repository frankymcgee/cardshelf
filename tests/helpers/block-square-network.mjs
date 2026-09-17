// Test-process preload only. Financial integration tests may never contact Square.
const original = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const value = String(input instanceof Request ? input.url : input);
  if (/^https:\/\/(?:connect\.squareup\.com|connect\.squareupsandbox\.com)(?:\/|$)/.test(value))
    throw new Error('External Square requests are prohibited in the test process.');
  return original(input, init);
};
