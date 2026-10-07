export async function fixtures(page,{blocked=false,rejectPreference=false,count=1,hidden=false,provider='adsense',initialMode}={}){
  let mode=initialMode || (hidden?'hidden':'preview');const requests=[],errors=[],saves=[];
  let settings={provider,adsterra_units:{},enabled:false,verification_enabled:false,placeholders_enabled:true,publisher_id:'',slot_id:'',marketplace_slot_id:'',auto_ads_enabled:false,marketplace_enabled:false,revision:1};
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(/googlesyndication|doubleclick|bicea\.org|afders\.org|arwf\.org/.test(r.url()))requests.push(r.url());});
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    let data={};
    if(path==='/api/session')data={user:{id:'admin-fixture',role:'admin',name:'Administrator'},setup_required:false,admin_placement_view:mode,admin_ad_provider:provider};
    else if(path==='/api/ads/adsense' && blocked)return route.abort('blockedbyclient');
    else if(path==='/api/ads/adsense')data=mode==='preview'?{eligible:false,placeholder:true,page_kind:'marketing',revision:1}:{eligible:false};
    else if(path==='/api/admin/adsense')data={...settings,admin_view:mode};
    else if(path==='/api/admin/adsense/settings'){const body=route.request().postDataJSON();saves.push(body);settings={...settings,...body,revision:settings.revision+1};provider=settings.provider;data=settings;}
    else if(path==='/api/admin/adsense/view'){if(!rejectPreference)mode=route.request().postDataJSON().mode;data={mode};}
    else if(path==='/api/public/catalogue')data={items:[{id:'en:demo-1',game:'pokemon',language:'en',name:'Test card',set_name:'Test set',local_id:'1'}],total:1,limit:24};
    else if(path==='/api/public/catalogue/sets')data=[];
    else if(path==='/api/catalogue')data={items:[{id:'en:demo-1',game:'pokemon',language:'en',name:'Test card',set_name:'Test set',local_id:'1',quantity:0,printings:[]}],total:1,limit:30};
    else if(path==='/api/marketplace/listings')data={items:[{id:'test-sale',photos:[{url:'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E'}],card_name:'Test card',set_name:'Test set',local_id:'1',printing_label:'Normal',condition:'NM',language:'en',status:'available',price_minor:100,seller_alias:'Test',region:'Test'}],total:1};
    else if(path==='/api/marketplace/access')data={can_sell:false,can_enquire:false};
    else if(path==='/api/catalogue/facets')data={sets:[],rarities:[]};
    else if(path==='/api/ads/sponsor')data={eligible:false};
    if(Array.isArray(data.items)){const sample=data.items[0];data.items=Array.from({length:count},(_,i)=>({...sample,id:sample.id+'-'+i}));data.total=count;}
    await route.fulfill({json:data});
  });
  return{requests,errors,saves};
}
