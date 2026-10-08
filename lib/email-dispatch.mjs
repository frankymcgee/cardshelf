// Both recovery and activity queues share one durable SMTP pacing reservation.
// No sleep or database transaction is held while connecting to a mail server.
export async function reserveEmailDispatch(sql, config, queue = 'notification') {
  if (config?.provider !== 'smtp' || !config.exists) return true;
  const [current] = await sql`SELECT enabled,provider,revision FROM email_settings WHERE singleton`;
  if (!current?.enabled || current.provider !== 'smtp' || current.revision !== config.revision) return false;
  const otherTable = queue === 'recovery' ? 'email_outbox' : 'password_recovery_mail';
  // Alternate while both queues have work. Otherwise the worker whose timer
  // fires first could repeatedly take every slot, starving password recovery.
  const rows = await sql`INSERT INTO email_dispatch_state(singleton,last_queue,next_send_at)
    VALUES(true,${queue},now()+${60 / config.smtp_rate_limit + 0.1}*interval '1 second')
    ON CONFLICT(singleton) DO UPDATE SET next_send_at=excluded.next_send_at,last_queue=excluded.last_queue
    WHERE email_dispatch_state.next_send_at<=now() AND
      (email_dispatch_state.last_queue IS DISTINCT FROM ${queue} OR NOT EXISTS (
        SELECT id FROM ${sql(otherTable)} WHERE status='queued' AND attempts<3
          AND available_at<=now() AND expires_at>now()
      )) RETURNING singleton`;
  return rows.length > 0;
}
export function knownEmailRejection(error) {
  return ['not_sent', 'rejected'].includes(error?.emailDelivery);
}
