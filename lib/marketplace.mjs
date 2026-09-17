import { db, audit } from './db.mjs';
import { ensure } from './errors.mjs';
import * as v from './validate.mjs';
import { ACCESS_ENFORCED } from '../shared/platform.mjs';
import { sellerAccess } from '../shared/marketplace.mjs';
import { listingInput, listingEdit, messageInput, reportInput, queryInput, contentHash, decodeSalePhoto, exact, revision, PHOTO_QUOTA } from './marketplace-validation.mjs';
import { salePhotos } from './marketplace-images.mjs';

export async function marketplaceAccess(userId, sql = db()) {
  const [row] = await sql`SELECT m.plan_code,m.subscription_status,g.kind,g.expires_at
    FROM app_users u LEFT JOIN account_memberships m ON m.user_id=u.id
    LEFT JOIN account_access_grants g ON g.user_id=u.id WHERE u.id=${userId}`;
  ensure(row, 401, 'Sign in to continue.');
  const access = sellerAccess({ enforcement: ACCESS_ENFORCED, grant: row.kind ? row : null, plan: row.plan_code, status: row.subscription_status });
  return { can_browse: true, can_sell: access.allowed, reason: access.reason, payments_enabled: false,
    message: 'Listings and private enquiries only. No checkout, escrow, payment processing or buyer protection is provided.' };
}
async function requireSeller(userId, sql = db()) {
  ensure((await marketplaceAccess(userId, sql)).can_sell, 403, 'Selling requires Collector Plus. Browsing and existing conversations remain available.');
}
async function userLock(sql, userId) {
  await sql`SELECT pg_advisory_xact_lock(hashtextextended(${'marketplace:' + userId},0))`;
}
async function rowFor(sql, id, lock = false) {
  v.uuid(id, 'Listing');
  const [row] = await sql`SELECT l.*,c.name AS card_name,c.id AS card_id,c.local_id,c.language,c.image_url AS catalogue_image_url,
    s.name AS set_name,p.label AS printing_label,p.key AS printing_key
    FROM marketplace_listings l JOIN printings p ON p.id=l.printing_id JOIN cards c ON c.id=p.card_id
    JOIN card_sets s ON s.id=c.set_id WHERE l.id=${id} ${lock ? sql`FOR UPDATE OF l` : sql``}`;
  ensure(row, 404, 'Listing not found.'); return row;
}
async function visible(sql, row, user) {
  if (row.seller_id === user.id || user.role === 'admin' || (!row.hidden && ['active', 'reserved'].includes(row.status))) return;
  const [thread] = await sql`SELECT id FROM marketplace_conversations WHERE listing_id=${row.id} AND buyer_id=${user.id}`;
  ensure(thread, 404, 'Listing not found.');
}
function listingView(row, user) {
  const owner = row.seller_id === user.id;
  return { id: row.id, printing_id: row.printing_id, card_id: row.card_id, card_name: row.card_name,
    local_id: row.local_id, language: row.language, set_name: row.set_name, printing_label: row.printing_label,
    printing_key: row.printing_key, seller_alias: row.seller_alias, condition: row.condition,
    price_minor: row.price_minor, postage_minor: row.postage_minor, currency: 'AUD', delivery: row.delivery,
    region: row.region, description: row.description, status: row.status, hidden: row.hidden,
    revision: row.revision, created_at: row.created_at, updated_at: row.updated_at,
    is_owner: owner, can_enquire: !owner && !row.hidden && row.status === 'active',
    moderation_reason: owner || user.role === 'admin' ? row.moderation_reason : '',
    photos: ['front','back'].map(side => ({ side, url: `/api/marketplace/listings/${row.id}/photos/${side}` })) };
}
export async function listSales(user, query) {
  const q = queryInput(query), sql = db();
  const filter = sql`${q.mine ? sql`l.seller_id=${user.id}` : sql`NOT l.hidden AND l.status IN ('active','reserved')`}
    AND (${q.q}='' OR position(lower(${q.q}) in lower(c.name || ' ' || c.local_id || ' ' || s.name || ' ' || l.region))>0)
    AND (${q.language}='' OR c.language=${q.language}) AND (${q.condition}='' OR l.condition=${q.condition})`;
  const order = q.order === 'price_low' ? sql`l.price_minor ASC,l.id` : q.order === 'price_high' ? sql`l.price_minor DESC,l.id` : sql`l.created_at DESC,l.id`;
  const joins = sql`FROM marketplace_listings l JOIN printings p ON p.id=l.printing_id JOIN cards c ON c.id=p.card_id JOIN card_sets s ON s.id=c.set_id`;
  const [rows, [count]] = await Promise.all([
    sql`SELECT l.*,c.id AS card_id,c.name AS card_name,c.local_id,c.language,s.name AS set_name,p.label AS printing_label,p.key AS printing_key
      ${joins} WHERE ${filter} ORDER BY ${order} LIMIT 24 OFFSET ${(q.page-1)*24}`,
    sql`SELECT count(*)::integer AS total ${joins} WHERE ${filter}`
  ]);
  return { items: rows.map(row => listingView(row, user)), total: count.total, page: q.page, page_size: 24 };
}
export async function getSale(user, id) {
  const sql = db(), row = await rowFor(sql, id); await visible(sql, row, user);
  const [thread] = await sql`SELECT id FROM marketplace_conversations WHERE listing_id=${id} AND buyer_id=${user.id}`;
  return { ...listingView(row, user), conversation_id: thread?.id ?? null };
}
export async function salePhoto(user, id, side) {
  v.oneOf(side, 'Photo side', ['front','back']);
  const sql = db(), row = await rowFor(sql, id); await visible(sql, row, user);
  const [photo] = await sql`SELECT data FROM marketplace_photos WHERE listing_id=${id} AND side=${side}`;
  ensure(photo, 404, 'Photo not found.'); return photo.data;
}
export async function findSalePrintings(userId, query = {}) {
  await requireSeller(userId);
  const q = v.text(query.q ?? '', 'Search', 0, 100), sql = db();
  return sql`SELECT p.id AS printing_id,p.label AS printing_label,c.id AS card_id,c.name AS card_name,c.local_id,c.language,
    c.image_url,s.name AS set_name,coalesce(o.quantity,0)::integer AS owned_quantity
    FROM printings p JOIN cards c ON c.id=p.card_id JOIN card_sets s ON s.id=c.set_id
    LEFT JOIN (SELECT printing_id,sum(quantity) AS quantity FROM collection_entries WHERE user_id=${userId} GROUP BY printing_id) o ON o.printing_id=p.id
    WHERE ${q}='' OR position(lower(${q}) in lower(c.name || ' ' || c.local_id || ' ' || s.name))>0
    ORDER BY coalesce(o.quantity,0) DESC,c.name,c.id,p.label LIMIT 24`;
}
export async function createSale(user, input) {
  await requireSeller(user.id);
  const data = listingInput(input);
  const decoded = input.photos.map(decodeSalePhoto).sort((a,b) => a.side.localeCompare(b.side));
  ensure(new Set(decoded.map(p => p.side)).size === 2, 400, 'Add one front and one back photo.');
  const hash = contentHash({ ...data, photos: decoded.map(p => ({ side:p.side, type:p.type, hash:contentHash(p.data.toString('base64')) })) });
  const sql = db();
  const [old] = await sql`SELECT id,input_hash FROM marketplace_listings WHERE seller_id=${user.id} AND request_id=${data.request_id}`;
  if (old) { ensure(old.input_hash === hash, 409, 'This request ID was already used for another listing.'); return { id:old.id, replayed:true }; }
  ensure((await sql`SELECT id FROM printings WHERE id=${data.printing_id}`).length, 404, 'Import the card and select its exact printing first.');
  const photos = await salePhotos(input.photos);
  return sql.begin(async tx => {
    await userLock(tx, user.id); await requireSeller(user.id, tx);
    const [previous] = await tx`SELECT id,input_hash FROM marketplace_listings WHERE seller_id=${user.id} AND request_id=${data.request_id}`;
    if (previous) { ensure(previous.input_hash === hash,409,'This request ID was already used for another listing.'); return {id:previous.id,replayed:true}; }
    const [count] = await tx`SELECT count(*)::integer AS total,count(*) FILTER(WHERE status IN ('active','reserved'))::integer AS live FROM marketplace_listings WHERE seller_id=${user.id}`;
    ensure(count.live < 100 && count.total < 500, 409, 'Listing limit reached. Withdraw unused listings and delete withdrawn listings without conversations.');
    const [usage] = await tx`SELECT coalesce(sum(octet_length(p.data)),0)::integer AS bytes FROM marketplace_photos p
      JOIN marketplace_listings l ON l.id=p.listing_id WHERE l.seller_id=${user.id}`;
    ensure(usage.bytes + photos.reduce((n,p) => n+p.data.length,0) <= PHOTO_QUOTA, 413, 'Marketplace photo storage is full (64 MB). Remove unused listings first.');
    const [listing] = await tx`INSERT INTO marketplace_listings(seller_id,request_id,input_hash,printing_id,seller_alias,condition,price_minor,delivery,postage_minor,region,description)
      VALUES(${user.id},${data.request_id},${hash},${data.printing_id},${data.seller_alias},${data.condition},${data.price_minor},${data.delivery},${data.postage_minor},${data.region},${data.description}) RETURNING id`;
    for (const p of photos) await tx`INSERT INTO marketplace_photos(listing_id,side,data) VALUES(${listing.id},${p.side},${p.data})`;
    await audit(tx,user.id,'marketplace.listing_created',{listing_id:listing.id});
    return {id:listing.id,replayed:false};
  });
}
export async function editSale(user, id, input) {
  return db().begin(async sql => {
    await userLock(sql,user.id);
    const row = await rowFor(sql,id,true); ensure(row.seller_id === user.id,404,'Listing not found.');
    const data = listingEdit(input,row);
    ensure(data.revision === row.revision,409,'The listing changed. Reload before saving.');
    if (data.status === 'active') {
      await requireSeller(user.id,sql);
      if (row.status === 'withdrawn') {
        const [count] = await sql`SELECT count(*)::integer AS live FROM marketplace_listings WHERE seller_id=${user.id} AND status IN ('active','reserved')`;
        ensure(count.live < 100,409,'Withdraw another active listing before relisting this card.');
      }
    }
    const [saved] = await sql`UPDATE marketplace_listings SET status=${data.status},price_minor=${data.price_minor},postage_minor=${data.postage_minor},
      description=${data.description},revision=revision+1,updated_at=now() WHERE id=${id} RETURNING id,revision,status`;
    await audit(sql,user.id,'marketplace.listing_updated',{listing_id:id,status:data.status}); return saved;
  });
}
export async function deleteSale(user, id, input) {
  const expected = revision(exact(input,['revision']).revision);
  return db().begin(async sql => {
    await userLock(sql,user.id);
    const row=await rowFor(sql,id,true);ensure(row.seller_id===user.id,404,'Listing not found.');
    ensure(row.revision===expected,409,'The listing changed. Reload before deleting.');
    ensure(row.status==='withdrawn'&&!row.hidden,409,'Only withdrawn, non-moderated listings may be deleted.');
    ensure(!(await sql`SELECT id FROM marketplace_conversations WHERE listing_id=${id} LIMIT 1`).length,409,'This listing has conversations. Keep it withdrawn to preserve the discussion.');
    ensure(!(await sql`SELECT id FROM marketplace_reports WHERE listing_id=${id} LIMIT 1`).length,409,'This listing has a moderation report and must be retained for review.');
    await sql`DELETE FROM marketplace_listings WHERE id=${id}`;
    await audit(sql,user.id,'marketplace.listing_deleted',{listing_id:id});return {deleted:true};
  });
}
export async function enquire(user, id, input) {
  const data=messageInput(input,true);
  return db().begin(async sql => {
    await userLock(sql,user.id);
    const row=await rowFor(sql,id,true);
    ensure(row.seller_id!==user.id,400,'You cannot enquire on your own listing.');
    const [existing]=await sql`SELECT id FROM marketplace_conversations WHERE listing_id=${id} AND buyer_id=${user.id}`;
    if(existing) return {id:existing.id,existing:true};
    ensure(!row.hidden&&row.status==='active',409,'This listing is not accepting new enquiries.');
    ensure(row.revision===data.revision,409,'The listing or asking price changed. Reload before enquiring.');
    ensure(!(await sql`SELECT id FROM marketplace_messages WHERE sender_id=${user.id} AND request_id=${data.request_id}`).length,409,'This message request ID was already used.');
    const [count]=await sql`SELECT count(*)::integer AS total FROM marketplace_conversations WHERE buyer_id=${user.id}`;
    ensure(count.total<1000,409,'Enquiry limit reached. Contact the administrator.');
    const [thread]=await sql`INSERT INTO marketplace_conversations(listing_id,buyer_id,quoted_price_minor,quoted_postage_minor)
      VALUES(${id},${user.id},${row.price_minor},${row.postage_minor}) RETURNING id`;
    await sql`INSERT INTO marketplace_messages(conversation_id,sender_id,request_id,body) VALUES(${thread.id},${user.id},${data.request_id},${data.message})`;
    await audit(sql,user.id,'marketplace.enquiry_created',{listing_id:id,conversation_id:thread.id});return {...thread,existing:false};
  });
}
async function threadFor(sql,user,id,lock=false) {
  v.uuid(id,'Conversation');
  const [thread]=await sql`SELECT t.*,l.seller_id,l.seller_alias,l.hidden,l.status AS listing_status,c.name AS card_name
    FROM marketplace_conversations t JOIN marketplace_listings l ON l.id=t.listing_id
    JOIN printings p ON p.id=l.printing_id JOIN cards c ON c.id=p.card_id
    WHERE t.id=${id} AND (t.buyer_id=${user.id} OR l.seller_id=${user.id}) ${lock?sql`FOR UPDATE OF t`:sql``}`;
  ensure(thread,404,'Conversation not found.');return thread;
}
function threadView(t,user) {
  return {id:t.id,listing_id:t.listing_id,card_name:t.card_name,seller_alias:t.seller_alias,
    buyer_alias:'Collector '+t.id.slice(0,6).toUpperCase(),my_role:t.buyer_id===user.id?'buyer':'seller',
    closed:t.closed,hidden:t.hidden,listing_status:t.listing_status,revision:t.revision,
    quoted_price_minor:t.quoted_price_minor,quoted_postage_minor:t.quoted_postage_minor,updated_at:t.updated_at};
}
export async function inbox(user,query={}) {
  const page=v.integer(Number(query.page??1),'Page',1,10000),sql=db();
  const rows=await sql`SELECT t.*,l.seller_id,l.seller_alias,l.hidden,l.status AS listing_status,c.name AS card_name
    FROM marketplace_conversations t JOIN marketplace_listings l ON l.id=t.listing_id JOIN printings p ON p.id=l.printing_id JOIN cards c ON c.id=p.card_id
    WHERE t.buyer_id=${user.id} OR l.seller_id=${user.id} ORDER BY t.updated_at DESC,t.id LIMIT 31 OFFSET ${(page-1)*30}`;
  return {items:rows.slice(0,30).map(t=>threadView(t,user)),has_more:rows.length>30,page};
}
export async function conversation(user,id,query={}) {
  const sql=db(),thread=await threadFor(sql,user,id);
  const before=query.before??'9223372036854775807';
  ensure(typeof before==='string'&&/^[1-9]\d{0,18}$/.test(before)&&BigInt(before)<=9223372036854775807n,400,'Invalid message cursor.');
  const rows=await sql`SELECT id::text,body,created_at,sender_id=${user.id} AS mine FROM marketplace_messages
    WHERE conversation_id=${id} AND id<${before}::bigint ORDER BY id DESC LIMIT 101`;
  return {thread:threadView(thread,user),messages:rows.slice(0,100).reverse(),has_older:rows.length>100};
}
export async function sendMessage(user,id,input) {
  const data=messageInput(input);
  return db().begin(async sql=>{
    await userLock(sql,user.id);
    const thread=await threadFor(sql,user,id,true);
    const [old]=await sql`SELECT id::text,conversation_id,body FROM marketplace_messages WHERE sender_id=${user.id} AND request_id=${data.request_id}`;
    if(old){ensure(old.conversation_id===id&&old.body===data.message,409,'This message request ID was already used.');return {id:old.id,replayed:true};}
    ensure(!thread.closed&&!thread.hidden,409,'This conversation is closed or the listing is under moderation.');
    const [count]=await sql`SELECT count(*)::integer AS total FROM marketplace_messages WHERE conversation_id=${id}`;
    ensure(count.total<500,409,'Conversation message limit reached.');
    const [message]=await sql`INSERT INTO marketplace_messages(conversation_id,sender_id,request_id,body) VALUES(${id},${user.id},${data.request_id},${data.message}) RETURNING id::text`;
    await sql`UPDATE marketplace_conversations SET revision=revision+1,updated_at=now() WHERE id=${id}`;
    return {...message,replayed:false};
  });
}
export async function closeConversation(user,id,input) {
  const expected=revision(exact(input,['revision']).revision);
  return db().begin(async sql=>{
    const thread=await threadFor(sql,user,id,true);
    ensure(thread.revision===expected,409,'The conversation changed. Reload before closing.');
    await sql`UPDATE marketplace_conversations SET closed=true,revision=revision+1,updated_at=now() WHERE id=${id}`;
    await audit(sql,user.id,'marketplace.conversation_closed',{conversation_id:id});return {closed:true};
  });
}
export async function reportSale(user,id,input) {
  const data=reportInput(input),sql=db(),row=await rowFor(sql,id);await visible(sql,row,user);
  ensure(row.seller_id!==user.id,400,'Withdraw your own listing instead of reporting it.');
  await sql`INSERT INTO marketplace_reports(listing_id,reporter_id,reason,details) VALUES(${id},${user.id},${data.reason},${data.details}) ON CONFLICT(listing_id,reporter_id) DO NOTHING`;
  return {received:true};
}
export async function moderationQueue(user,query={}) {
  ensure(user.role==='admin',403,'Administrator access is required.');
  const page=v.integer(Number(query.page??1),'Page',1,10000);
  const rows=await db()`SELECT r.id,r.reason,r.details,r.created_at,r.status,l.id AS listing_id,l.seller_alias,l.hidden,l.revision,c.name AS card_name
    FROM marketplace_reports r JOIN marketplace_listings l ON l.id=r.listing_id JOIN printings p ON p.id=l.printing_id JOIN cards c ON c.id=p.card_id
    WHERE r.status='open' ORDER BY r.created_at,r.id LIMIT 31 OFFSET ${(page-1)*30}`;
  return {items:rows.slice(0,30),has_more:rows.length>30,page};
}
export async function moderateSale(user,id,input) {
  ensure(user.role==='admin',403,'Administrator access is required.');
  const o=exact(input,['revision','hidden','reason']),expected=revision(o.revision),hidden=v.bool(o.hidden,'Hide listing'),reason=v.text(o.reason,'Moderation reason',10,1000);
  return db().begin(async sql=>{
    const row=await rowFor(sql,id,true);ensure(row.revision===expected,409,'The listing changed. Reload before moderating.');
    await sql`UPDATE marketplace_listings SET hidden=${hidden},moderation_reason=${reason},revision=revision+1,updated_at=now() WHERE id=${id}`;
    await sql`UPDATE marketplace_reports SET status='resolved' WHERE listing_id=${id}`;
    await audit(sql,user.id,'marketplace.moderation',{listing_id:id,hidden,reason});return {hidden};
  });
}
