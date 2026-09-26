import { db, audit } from './db.mjs';
import { ensure } from './errors.mjs';
import * as v from './validate.mjs';
import { rateLimit } from './auth.mjs';
import { requestInput, planInput, requestStatusInput } from './platform-validation.mjs';
import { billingPolicy } from './billing-policy.mjs';
import { testingAccess } from '../shared/platform.mjs';
const RECEIVED={received:true,message:'Your request has been recorded for the CardShelf administrator. This is not an account approval or an automatic email.'};
export async function receiveRequest(input,ip) {
  const o=v.object(input);
  await rateLimit('platform-request-ip:'+ip,10);
  if(typeof o.website==='string' && o.website.trim()) return RECEIVED;
  const data=requestInput(o);
  await rateLimit('platform-request-email:'+data.email,5);
  await rateLimit('platform-request-global',200);
  return db().begin(async sql=> {
    // Cap pending requests while keeping duplicate/existing emails indistinguishable.
    await sql`SELECT pg_advisory_xact_lock(72490404)`;
    const [known]=await sql`SELECT id FROM platform_requests WHERE email=${data.email} AND purpose=${data.purpose}`;
    if(known) return RECEIVED;
    const [{n}]=await sql`SELECT count(*)::integer AS n FROM platform_requests WHERE status<>'archived'`;
    ensure(n<2000,503,'The request queue is full. Please try again later.');
    await sql`INSERT INTO platform_requests(email,name,purpose,message)
      VALUES(${data.email},${data.name},${data.purpose},${data.message}) ON CONFLICT(email,purpose) DO NOTHING`;
    return RECEIVED;
  });
}
export async function accountMembership(userId) {
  const sql=db();
  const [rows,grants]=await Promise.all([
    sql`SELECT m.plan_code,p.name AS plan_name,m.subscription_status,m.current_period_end,m.created_at
      FROM account_memberships m JOIN membership_plans p ON p.code=m.plan_code WHERE m.user_id=${userId}`,
    sql`SELECT kind,granted_at,expires_at FROM account_access_grants WHERE user_id=${userId}`
  ]);
  return {membership:rows[0]??null,grant:grants[0]??null,access:testingAccess(grants[0]),
    message:'Testing access is active. No payment method, automatic expiry or subscription charge is required.'};
}
export async function adminPlatform(query={}) {
  const sql=db(),page=v.integer(Number(query.page??1),'Page',1,10000);
  const requestsOnly=query.view==='requests';
  const [plans,members,requests,counts]=await Promise.all([
    requestsOnly?Promise.resolve([]):sql`SELECT * FROM membership_plans ORDER BY CASE WHEN code='testing' THEN 0 ELSE 1 END,code`,
    requestsOnly?Promise.resolve([]):sql`SELECT u.id,u.email,u.name,u.role,m.plan_code,m.subscription_status,g.kind AS grant_kind,g.granted_at
      FROM app_users u LEFT JOIN account_memberships m ON m.user_id=u.id LEFT JOIN account_access_grants g ON g.user_id=u.id
      ORDER BY u.created_at,u.id LIMIT 50 OFFSET ${(page-1)*50}`,
    sql`SELECT id,email,name,purpose,message,status,revision,created_at FROM platform_requests
      ORDER BY CASE WHEN status='new' THEN 0 WHEN status='contacted' THEN 1 ELSE 2 END,created_at DESC,id
      LIMIT 50 OFFSET ${(page-1)*50}`,
    requestsOnly?sql`SELECT count(*)::integer AS requests,count(*) FILTER(WHERE status='new')::integer AS new_requests FROM platform_requests`:sql`SELECT (SELECT count(*)::integer FROM app_users) AS members,
      (SELECT count(*)::integer FROM platform_requests) AS requests,
      (SELECT count(*)::integer FROM platform_requests WHERE status='new') AS new_requests`
  ]);
  if(requestsOnly)return {requests,counts:counts[0],page,page_size:50};
  const policy=await billingPolicy(sql);
  return {plans,members,requests,counts:counts[0],page,page_size:50,billing_enabled:policy.enabled,enforcement_enabled:policy.enforce};
}
export async function saveDraftPlan(actorId,code,input) {
  v.oneOf(code,'Draft plan',['collector','plus']);
  const p=planInput(input);
  return db().begin(async sql=> {
    const [saved]=await sql`UPDATE membership_plans SET name=${p.name},description=${p.description},
      monthly_price_minor=${p.monthly_price_minor},annual_price_minor=${p.annual_price_minor},revision=revision+1,updated_at=now()
      WHERE code=${code} AND state='draft' AND NOT stripe_managed AND revision=${p.revision} RETURNING *`;
    ensure(saved,409,'This plan is Stripe-managed or was updated elsewhere. Manage synced plans in Stripe.');
    await audit(sql,actorId,'platform.plan_draft_saved',{code});return saved;
  });
}
export async function updateRequest(actorId,id,input) {
  v.uuid(id);const r=requestStatusInput(input);
  return db().begin(async sql=> {
    const [saved]=await sql`UPDATE platform_requests SET status=${r.status},revision=revision+1,updated_at=now()
      WHERE id=${id} AND revision=${r.revision} RETURNING id,status,revision`;
    ensure(saved,409,'The request changed or was deleted. Reload the list.');
    await audit(sql,actorId,'platform.request_status',{request_id:id,status:r.status});return saved;
  });
}
export async function deleteRequest(actorId,id,input) {
  v.uuid(id);const revision=v.integer(v.object(input).revision,'Revision',1,Number.MAX_SAFE_INTEGER);
  return db().begin(async sql=> {
    const removed=await sql`DELETE FROM platform_requests WHERE id=${id} AND revision=${revision} RETURNING id`;
    ensure(removed.length===1,409,'The request changed or was deleted. Reload the list.');
    await audit(sql,actorId,'platform.request_deleted',{request_id:id});return {deleted:true};
  });
}
