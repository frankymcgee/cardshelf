import { defineEventHandler, setHeader } from 'h3'
export default defineEventHandler(event => {
  setHeader(event,'Content-Type','text/plain; charset=utf-8')
  const config=useRuntimeConfig(event)
  let origin='https://cardshelf.cloud'
  try{const u=new URL(String(config.public.siteUrl));if(['http:','https:'].includes(u.protocol)&&!u.username&&!u.password)origin=u.origin}catch{}
  return 'User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /app\nDisallow: /cards\nDisallow: /binders\nDisallow: /settings\nDisallow: /account\nDisallow: /admin/\nDisallow: /login\nDisallow: /print/\nDisallow: /shared/\nSitemap: '+origin+'/sitemap.xml\n'
})
