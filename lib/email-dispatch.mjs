// Both recovery and activity queues share one durable SMTP pacing reservation.
// No sleep or database transaction is held while connecting to a mail server.
export async function reserveEmailDispatch(sql, config) {
  if (config?.provider !== 'smtp' || !config.exists) return true;
  const [current] = await sql`SELECT enabled,provider,revision FROM email_settings WHERE singleton`;
  if (!current?.enabled || current.provider !== 'smtp' || current.revision !== config.revision) return false;
  const rows = await sql`INSERT INTO email_dispatch_state(singleton,next_send_at)
    VALUES(true,now()+${60 / config.smtp_rate_limit + 0.1}*interval '1 second')
    ON CONFLICT(singleton) DO UPDATE SET next_send_at=excluded.next_send_at
    WHERE email_dispatch_state.next_send_at<=now() RETURNING singleton`;
  return rows.length > 0;
}
export function knownEmailRejection(error) {
  return ['not_sent', 'rejected'].includes(error?.emailDelivery);
}
