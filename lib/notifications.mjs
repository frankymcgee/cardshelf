import { enqueueEmail } from './email-outbox.mjs';
import { enqueuePush } from './push.mjs';
// Both optional channels use the event transaction and their own preferences.
export async function enqueueNotifications(sql,event) {
  await enqueueEmail(sql,event);
  await enqueuePush(sql,event);
}
