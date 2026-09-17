import { randomBytes } from 'node:crypto';
import { db,audit } from './db.mjs';
import { ensure } from './errors.mjs';
import * as v from './validate.mjs';
import { referralInput,referralReady,commissionAmount,strictObject } from './subscription-logic.mjs';
export async function approveReferralPartner(actorId,userId,input) {
  v.uuid(userId);const o=referralInput(input);
  return db().begin(async sql=>{
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${'partner:'+userId},0))`;
    ensure((await sql`SELECT id FROM app_users WHERE id=${userId}`).length,404,'Account not found.');
    const [old]=await sql`SELECT * FROM referral_partners WHERE user_id=${userId} FOR UPDATE`;
    ensure((old?.revision??0)===o.revision,409,'Referral terms changed. Reload before saving.');
    const [saved]=await sql`INSERT INTO referral_partners(user_id,code,status,reward_type,reward_value,max_payments,hold_days,terms)
      VALUES(${userId},${randomBytes(12).toString('hex')},${o.status},${o.reward_type},${o.reward_value},${o.max_payments},${o.hold_days},${o.terms})
      ON CONFLICT(user_id) DO UPDATE SET status=excluded.status,reward_type=excluded.reward_type,reward_value=excluded.reward_value,
      max_payments=excluded.max_payments,hold_days=excluded.hold_days,terms=excluded.terms,revision=referral_partners.revision+1,opted_in_revision=NULL,opted_in_at=NULL RETURNING *`;
    await audit(sql,actorId,'referral.partner_terms',{user_id:userId,revision:saved.revision,status:o.status});return saved;
  });
}
export async function referralConsent(userId,input) {
  const o=strictObject(input,['revision','consent']),revision=v.integer(o.revision,'Revision',1),consent=v.bool(o.consent,'Consent');
  const [partner]=await db()`UPDATE referral_partners SET opted_in_revision=${consent?revision:null},opted_in_at=${consent?new Date():null}
    WHERE user_id=${userId} AND revision=${revision} ${consent?db()`AND status='approved'`:db()``} RETURNING *`;
  ensure(partner,409,'Approval or referral terms changed. Reload before choosing.');
  await audit(db(),userId,'referral.consent',{consent,revision});return {partner,active:referralReady(partner)};
}
export async function claimReferral(userId,input) {
  const o=strictObject(input,['code','consent']);ensure(o.consent===true,400,'Confirm that this referral may earn the referrer a commission.');
  const code=v.text(o.code,'Referral code',24,24).toLowerCase();ensure(/^[a-f0-9]{24}$/.test(code),400,'Invalid referral code.');
  return db().begin(async sql=>{
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${'billing:'+userId},0))`;
    const [partner]=await sql`SELECT * FROM referral_partners WHERE code=${code} FOR SHARE`;
    ensure(partner&&referralReady(partner),409,'This referral is not currently accepting new subscribers.');
    ensure(partner.user_id!==userId,400,'Self-referrals are not eligible.');
    const [old]=await sql`SELECT partner_user_id FROM referral_attributions WHERE referred_user_id=${userId}`;
    if(old){ensure(old.partner_user_id===partner.user_id,409,'A referral has already been assigned to this account.');return {claimed:true};}
    ensure(!(await sql`SELECT id FROM square_subscriptions WHERE user_id=${userId} AND environment='production' LIMIT 1`).length,409,'A referral must be claimed before the first production subscription request.');
    const terms={reward_type:partner.reward_type,reward_value:partner.reward_value,max_payments:partner.max_payments,hold_days:partner.hold_days,terms:partner.terms,revision:partner.revision};
    await sql`INSERT INTO referral_attributions(referred_user_id,partner_user_id,terms_snapshot) VALUES(${userId},${partner.user_id},${sql.json(terms)})`;
    await audit(sql,userId,'referral.claimed',{partner_user_id:partner.user_id});return {claimed:true};
  });
}
export async function reconcileCommission(sql,subscription,invoice) {
  if(subscription.environment!=='production')return; // sandbox money never becomes payable
  const [attribution]=await sql`SELECT a.*,p.status,p.opted_in_at,p.opted_in_revision,p.revision AS partner_revision
    FROM referral_attributions a JOIN referral_partners p ON p.user_id=a.partner_user_id
    WHERE a.referred_user_id=${subscription.user_id} FOR UPDATE OF a`;
  if(!attribution)return;
  const [old]=await sql`SELECT * FROM referral_commissions WHERE environment='production' AND invoice_id=${invoice.square_id} FOR UPDATE`;
  if(!old){
    const [first]=await sql`SELECT id FROM square_subscriptions WHERE user_id=${subscription.user_id} AND environment='production' ORDER BY created_at,id LIMIT 1`;
    if(first?.id!==subscription.id||!invoice.first_paid_at||!invoice.cycle_number||invoice.cycle_number>attribution.terms_snapshot.max_payments)return;
    if(attribution.status!=='approved'||!attribution.opted_in_at||attribution.opted_in_revision!==attribution.partner_revision)return;
    if(new Date(attribution.created_at)>new Date(subscription.created_at))return;
  }
  const earned=commissionAmount(invoice,attribution.terms_snapshot),blocked=invoice.disputed||invoice.refund_pending;
  if(old){
    if(old.earned_minor!==earned||old.blocked!==blocked)await sql`UPDATE referral_commissions SET earned_minor=${earned},blocked=${blocked},approved=false,revision=revision+1,updated_at=now() WHERE id=${old.id}`;
  }else if(earned>0)await sql`INSERT INTO referral_commissions(attribution_id,environment,invoice_id,earned_minor,eligible_at,blocked)
    VALUES(${attribution.id},'production',${invoice.square_id},${earned},${new Date(new Date(invoice.first_paid_at).getTime()+attribution.terms_snapshot.hold_days*86400000)},${blocked}) ON CONFLICT DO NOTHING`;
}
export async function referralAccount(userId) {
  const sql=db();
  const [partners,earnings,counts,attributions]=await Promise.all([
    sql`SELECT code,status,reward_type,reward_value,max_payments,hold_days,terms,revision,opted_in_revision,opted_in_at FROM referral_partners WHERE user_id=${userId}`,
    sql`SELECT c.id,c.earned_minor,c.paid_minor,c.eligible_at,c.approved,c.blocked,c.revision,c.created_at
      FROM referral_commissions c JOIN referral_attributions a ON a.id=c.attribution_id WHERE a.partner_user_id=${userId} ORDER BY c.created_at DESC LIMIT 100`,
    sql`SELECT count(*)::integer AS referred_accounts FROM referral_attributions WHERE partner_user_id=${userId}`,
    sql`SELECT p.code FROM referral_attributions a JOIN referral_partners p ON p.user_id=a.partner_user_id WHERE a.referred_user_id=${userId}`
  ]);
  // Referrers receive no subscriber identity, email, contact, invoice URL or provider ID.
  return {partner:partners[0]??null,active:referralReady(partners[0]),earnings,referred_accounts:counts[0].referred_accounts,claimed_code:attributions[0]?.code??null};
}
export async function approveCommission(actorId,id,input) {
  v.uuid(id);const o=strictObject(input,['revision','approved']),revision=v.integer(o.revision,'Revision',1),approved=v.bool(o.approved,'Approved');
  return db().begin(async sql=>{
    await sql`SELECT pg_advisory_xact_lock(72490703)`;
    // Lock the invoice before its commission, in the same order as reconciliation.
    const [invoice]=await sql`SELECT i.verified_at,i.disputed,i.refund_pending FROM referral_commissions c JOIN square_invoices i ON i.environment=c.environment AND i.square_id=c.invoice_id WHERE c.id=${id} FOR UPDATE OF i`;
    const [commission]=await sql`SELECT * FROM referral_commissions WHERE id=${id} FOR UPDATE`;
    const row=commission&&invoice?{...commission,...invoice}:null;
    ensure(row&&row.revision===revision,409,'Commission changed. Reload first.');
    if(approved)ensure(row.earned_minor>row.paid_minor&&!row.blocked&&!row.disputed&&!row.refund_pending&&new Date(row.eligible_at)<=new Date()&&Date.now()-new Date(row.verified_at)<600000,
      409,'The commission must clear its hold and be reconciled with Square within the last 10 minutes.');
    const [saved]=await sql`UPDATE referral_commissions SET approved=${approved},revision=revision+1,updated_at=now() WHERE id=${id} RETURNING *`;
    await audit(sql,actorId,'referral.commission_approval',{commission_id:id,approved});return saved;
  });
}
export async function recordReferralPayout(actorId,id,input) {
  v.uuid(id);const o=strictObject(input,['revision','request_id','amount_minor','external_reference','confirm_paid']);
  ensure(o.confirm_paid===true,400,'Confirm that this payment has ALREADY been made outside CardShelf.');
  const requestId=v.uuid(o.request_id),amount=v.integer(o.amount_minor,'Paid amount',1,10000000),revision=v.integer(o.revision,'Revision',1),reference=v.text(o.external_reference,'Payment reference',3,200);
  return db().begin(async sql=>{
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${'referral-payout:'+requestId},0))`;
    const [prior]=await sql`SELECT * FROM referral_payout_records WHERE request_id=${requestId}`;
    if(prior){ensure(prior.commission_id===id&&prior.amount_minor===amount&&prior.external_reference===reference,409,'This payout request ID was used for different details.');return {recorded:true,replayed:true};}
    await sql`SELECT pg_advisory_xact_lock(72490703)`;
    // Lock the invoice before its commission, in the same order as reconciliation.
    const [invoice]=await sql`SELECT i.verified_at,i.disputed,i.refund_pending FROM referral_commissions c JOIN square_invoices i ON i.environment=c.environment AND i.square_id=c.invoice_id WHERE c.id=${id} FOR UPDATE OF i`;
    const [commission]=await sql`SELECT * FROM referral_commissions WHERE id=${id} FOR UPDATE`;
    const row=commission&&invoice?{...commission,...invoice}:null;
    ensure(row&&row.revision===revision,409,'Commission changed. Reload before recording payment.');
    ensure(row.approved&&!row.blocked&&!row.disputed&&!row.refund_pending&&new Date(row.eligible_at)<=new Date()&&Date.now()-new Date(row.verified_at)<600000,409,'Reconcile and approve the eligible commission first.');
    const [balance]=await sql`SELECT sum(c.earned_minor-c.paid_minor)::text AS outstanding FROM referral_commissions c JOIN referral_attributions a ON a.id=c.attribution_id WHERE a.partner_user_id=(SELECT partner_user_id FROM referral_attributions WHERE id=${row.attribution_id})`;
    ensure(BigInt(balance.outstanding??'0')>=BigInt(amount),409,'Other referral refunds require recovery or reconciliation before recording this payout.');
    ensure(amount===row.earned_minor-row.paid_minor,409,'Record only the currently approved outstanding amount.');
    await sql`INSERT INTO referral_payout_records(commission_id,request_id,amount_minor,external_reference,recorded_by) VALUES(${id},${requestId},${amount},${reference},${actorId})`;
    await sql`UPDATE referral_commissions SET paid_minor=paid_minor+${amount},revision=revision+1,updated_at=now() WHERE id=${id}`;
    await audit(sql,actorId,'referral.manual_payment_recorded',{commission_id:id,amount_minor:amount,external_reference:reference});
    return {recorded:true,replayed:false,transfer_initiated:false};
  });
}
