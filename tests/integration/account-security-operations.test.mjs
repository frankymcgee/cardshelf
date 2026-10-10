// Invoked by the post-migration integration job. Importing the shared suite only
// after these checks keeps the pre-migration unit-test stage database-free.
let disposable = false;
try {
  const target = new URL(process.env.DATABASE_URL || '');
  disposable = ['postgres:', 'postgresql:'].includes(target.protocol) && target.pathname.endsWith('_test');
} catch {}
if (process.env.ALLOW_TEST_DATABASE !== 'yes' || !disposable) {
  throw Error('Use an explicitly permitted, migrated disposable _test database for security operations integration tests.');
}
process.env.CARDSHELF_SECURITY_DB_TESTS = 'yes';
await import('../account-security-operations.test.mjs');
