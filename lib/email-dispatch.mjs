// All transactional mail queues share one durable SMTP pacing reservation.
// Round-robin selection prevents any timer from starving account-access mail.
// No sleep or database transaction is held while connecting to a mail server.
const queues = ['notification', 'recovery', 'verification'];
export async function reserveEmailDispatch(sql, config, queue = 'notification') {
  if (config?.provider !== 'smtp' || !config.exists) return true;
  if (!queues.includes(queue)) throw new Error('Unsupported email queue.');
  const [current] = await sql`SELECT enabled,provider,revision FROM email_settings WHERE singleton`;
  if (!current?.enabled || current.provider !== 'smtp' || current.revision !== config.revision) return false;
  await sql`INSERT INTO email_dispatch_state(singleton,next_send_at) VALUES(true,now()) ON CONFLICT(singleton) DO NOTHING`;
  const [state] = await sql`SELECT last_queue,next_send_at<=now() AS available FROM email_dispatch_state WHERE singleton FOR UPDATE`;
  if (!state.available) return false;
  const due = await sql`SELECT 'notification' AS queue WHERE EXISTS (
      SELECT 1 FROM email_outbox WHERE status='queued' AND attempts<3 AND available_at<=now() AND expires_at>now())
    UNION ALL SELECT 'recovery' AS queue WHERE EXISTS (
      SELECT 1 FROM password_recovery_mail WHERE status='queued' AND attempts<3 AND available_at<=now() AND expires_at>now())
    UNION ALL SELECT 'verification' AS queue WHERE EXISTS (
      SELECT 1 FROM email_verification_mail r WHERE r.status='queued' AND r.attempts<3 AND r.available_at<=now() AND r.expires_at>now()
        AND EXISTS (SELECT 1 FROM app_users u WHERE lower(u.email)=r.email AND u.email_verified_at IS NULL
          AND (r.user_id IS NULL OR r.user_id=u.id)))`;
  const ready = new Set(due.map(row => row.queue));
  if (state.last_queue) {
    const after = queues.indexOf(state.last_queue);
    const next = [1, 2, 3].map(offset => queues[(after + offset) % queues.length]).find(candidate => ready.has(candidate));
    if (next && next !== queue) return false;
  }
  await sql`UPDATE email_dispatch_state SET next_send_at=now()+${60 / config.smtp_rate_limit + 0.1}*interval '1 second',
    last_queue=${queue} WHERE singleton`;
  return true;
}
export function knownEmailRejection(error) {
  return ['not_sent', 'rejected'].includes(error?.emailDelivery);
}
