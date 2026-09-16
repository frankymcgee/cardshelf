import { defineEventHandler, setHeader } from 'h3'
import { PUBLIC_PAGES } from '../../shared/platform.mjs'
export default defineEventHandler(event => {
  setHeader(event,'Content-Type','application/xml; charset=utf-8')
  const config=useRuntimeConfig(event)
  let origin='https://tcg.webwire.cloud'
  try{const u=new URL(String(config.public.siteUrl));if(['http:','https:'].includes(u.protocol)&&!u.username&&!u.password)origin=u.origin}catch{}
  const escape=(value:string)=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
  return '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+PUBLIC_PAGES.map(path=>'<url><loc>'+escape(origin+path)+'</loc></url>').join('')+'</urlset>'
})
