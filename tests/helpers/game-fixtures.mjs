// Synthetic fixtures shaped like the published provider schemas. Not real prices.
export const FRONT='11111111-1111-4111-8111-111111111111';
export const BACK='22222222-2222-4222-8222-222222222222';
export const ART='33333333-3333-4333-8333-333333333333';
export const DAY='2026-09-18';
export function ygoFixture(){return {
  set:{game:'yugioh',code:'DEMO-123456789abc',source_code:'DEMO',name:'Synthetic YGO Set'},
  payload:{data:[{id:123456,name:'Synthetic Dragon',type:'Normal Monster',desc:'Not a real card.',
    card_sets:[{set_name:'Synthetic YGO Set',set_code:'DEMO-EN001',set_rarity:'Common',set_price:'2.50'},
      {set_name:'Synthetic YGO Set',set_code:'DEMO-EN001',set_rarity:'Ultra Rare',set_price:'7.00'},
      {set_name:'Another Set',set_code:'OTHER-001',set_rarity:'Common',set_price:'999.00'}],
    card_images:[{id:123456,image_url:'https://untrusted.example/image.jpg'}],
    card_prices:[{cardmarket_price:'1.20',tcgplayer_price:'1.50'}]}]}
};}
export function mtgFixture(){return {
  set:{game:'mtg',code:'DEMO',source_code:'DEMO',name:'Synthetic Magic Set'},
  payload:{data:{code:'DEMO',cards:[{uuid:FRONT,name:'Synthetic Front // Back',faceName:'Front',number:'1',side:'a',otherFaceIds:[BACK],
    language:'English',availability:['paper'],finishes:['nonfoil','foil','etched'],type:'Creature',rarity:'rare',artist:'Synthetic',text:'Front rules.',identifiers:{scryfallId:ART}},
    {uuid:BACK,name:'Synthetic Front // Back',faceName:'Back',number:'1',side:'b',otherFaceIds:[FRONT],language:'English',
      availability:['paper'],finishes:['nonfoil','foil'],text:'Back rules.'}]}},
  feed: {
    meta: {date: DAY},
    data: {
      [FRONT]: {
        paper: {
          tcgplayer: {currency: 'USD', retail: {normal: {[DAY]: 10}, foil: {[DAY]: 20}, etched: {[DAY]: 30}}},
          cardmarket: {currency: 'EUR', retail: {normal: {[DAY]: 8}, foil: {[DAY]: 16}, etched: {[DAY]: 24}}}
        },
        mtgo: {cardhoarder: {currency: 'USD', retail: {normal: {[DAY]: 999}}}}
      }
    }
  }
};}
