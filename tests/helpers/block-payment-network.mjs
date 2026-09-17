// Import in financial contract tests before running application services.
const original=globalThis.fetch;
globalThis.fetch=(input,init)=>{
  const url=new URL(String(input instanceof Request?input.url:input));
  if(['api.stripe.com','connect.squareup.com','connect.squareupsandbox.com'].includes(url.hostname))throw new Error('Live payment-provider requests are forbidden in this test process.');
  return original(input,init);
};
