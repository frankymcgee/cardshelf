/** Navigation is presentation only; all permissions remain enforced by the APIs. */
/** @typedef {{id:string,label:string,icon:string,to?:string,sheet?:string}} NavItem */
/** @type {readonly NavItem[]} */
export const PRIMARY_NAVIGATION = Object.freeze([
  { id:'home', label:'Home', icon:'home', to:'/app' },
  { id:'collection', label:'Collection', icon:'binder', sheet:'collection' },
  { id:'market', label:'Market', icon:'share', to:'/marketplace' },
  { id:'arena', label:'Arena', icon:'cards', to:'/arena' },
  { id:'more', label:'More', icon:'grid', sheet:'more' }
]);
/** @typedef {{to:string,label:string,description:string,icon:string}} NavCard */
/** @type {readonly NavCard[]} */
export const COLLECTION_LINKS = Object.freeze([
  { to:'/cards', label:'Cards & wishlist', description:'Browse cards, ownership and your wishlist.', icon:'cards' },
  { to:'/scan', label:'Scan a card', description:'Find a Pokémon card from a photo and review your addition.', icon:'search' },
  { to:'/binders', label:'Your binders', description:'Tracking, layouts and collection binders.', icon:'binder' },
  { to:'/games', label:'Card games', description:'Choose the games you collect.', icon:'grid' },
  { to:'/explore', label:'Public catalogue', description:'Explore all supported card games.', icon:'search' }
]);
/** @type {readonly {id:string,title:string,links:readonly NavCard[]}[]} */
export const MORE_GROUPS = Object.freeze([
  { id:'account', title:'Your account', links:[
    {to:'/account',label:'Account',description:'Profile and password.',icon:'shield'},
    {to:'/emails',label:'Email preferences',description:'Your marketplace and membership email preferences.',icon:'mail'},
    {to:'/membership',label:'Membership',description:'Your plan and subscription.',icon:'star'},
    {to:'/referrals',label:'Referrals',description:'Referral access and rewards.',icon:'share'}
  ]},
  { id:'tools', title:'Tools & website', links:[
    {to:'/settings',label:'Data & settings',description:'Imports, exports and account tools.',icon:'settings'},
    {to:'/',label:'Visit the website',description:'CardShelf homepage and public information.',icon:'arrow'}
  ]}
]);
/** @type {readonly NavCard[]} */
export const ADMIN_LINKS = Object.freeze([
  {to:'/admin/platform',label:'Platform',description:'People, plans and product sync.',icon:'settings'},
  {to:'/admin/memberships',label:'Memberships & referrals',description:'Assign tiers and review referrals.',icon:'shield'},
  {to:'/admin/integrations/stripe',label:'Stripe',description:'Connection and billing controls.',icon:'link'},
  {to:'/admin/integrations/stripe-preview',label:'Test pricing preview',description:'Review Sandbox products without billing.',icon:'cards'},
  {to:'/admin/game-catalogue',label:'Game imports',description:'Import additional card games.',icon:'download'},
  {to:'/admin/free-platform',label:'Free tier & sponsors',description:'Registration and first-party ads.',icon:'grid'},
  {to:'/admin/adsense',label:'Google AdSense',description:'Ad units, Auto ads and verification.',icon:'settings'},
  {to:'/admin/emails',label:'Emails',description:'Postal, delivery, DNS checks and suppressed recipients.',icon:'mail'},
  {to:'/admin/scanning',label:'Card scanning',description:'OpenAI connection, scan allowances and costs.',icon:'search'},
  {to:'/admin/passwords',label:'Password recovery',description:'Help an account recover access.',icon:'shield'},
  {to:'/admin/arena',label:'Arena administration',description:'Availability and supported gameplay.',icon:'cards'}
]);
/** @param {string} value */
export function navigationPath(value) {
  return typeof value==='string' ? value.split(/[?#]/,1)[0].replace(/\/+$/,'') || '/' : '/';
}
/** @param {string} path @param {string} root */
export function navigationMatches(path,root) {
  const p=navigationPath(path);return p===root||(root!=='/'&&p.startsWith(root+'/'));
}
/** @param {string} path @returns {string} */
export function activeNavigation(path) {
  if(navigationMatches(path,'/app'))return 'home';
  if(['/cards','/scan','/binders','/games','/explore'].some(root=>navigationMatches(path,root)))return 'collection';
  if(navigationMatches(path,'/marketplace'))return 'market';
  if(navigationMatches(path,'/arena')||navigationMatches(path,'/battle'))return 'arena';
  return 'more';
}
/** @param {string|null|undefined} role @returns {readonly NavCard[]} */
export function administrationLinks(role) { return role==='admin'?ADMIN_LINKS:[]; }
