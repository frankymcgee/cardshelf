/** Optional local audio only. Never changes a match or sends hidden state anywhere. */
export const AUDIO_PREFERENCE_KEY='cardshelf-arena-audio-v1';
export const ARENA_AUDIO=Object.freeze({
  select:'/audio/arena/kenney-click.wav', card:'/audio/arena/kenney-card.wav',
  attack:'/audio/arena/attack.wav', knockout:'/audio/arena/knockout.wav',
  coin:'/audio/arena/coin.wav', turn:'/audio/arena/turn.wav',
  victory:'/audio/arena/victory.wav', defeat:'/audio/arena/defeat.wav'
});
export const ARENA_TRACKS=Object.freeze([
  {id:'quiet',name:'Quiet table',url:'/audio/arena/quiet-table.mp3'},
  {id:'pulse',name:'Pulse table',url:'/audio/arena/pulse-table.mp3'}
]);
export function audioPreferences(value={}) {
  const v=value&&typeof value==='object'?value:{};
  const volume=(n,fallback)=>typeof n==='number'&&Number.isFinite(n)?Math.min(1,Math.max(0,n)):fallback;
  return {effects:v.effects===true,music:v.music===true,track:ARENA_TRACKS.some(t=>t.id===v.track)?v.track:'quiet',
    effectsVolume:volume(v.effectsVolume,.45),musicVolume:volume(v.musicVolume,.25)};
}
/** @param {Array<{n:number,kind:string}>} events @param {number} previous @param {string|number|null|undefined} result @param {number} seat */
export function arenaEventCue(events=[],previous=-1,result=null,seat=0) {
  if(previous<0||!Array.isArray(events))return null;
  const recent=events.filter(e=>Number.isSafeInteger(e?.n)&&e.n>previous);
  // A reconnect does not play the entire buffered action history.
  if(!recent.length||recent.length>12)return null;
  if(recent.some(e=>e.kind==='result'))return result==='draw'?'turn':result===seat?'victory':'defeat';
  for(const kind of ['knockout','attack','coin','turn'])if(recent.some(e=>e.kind===kind))return kind;
  return recent.some(e=>['draw','attach','bench','evolve','prize','trainer','switch','retreat'].includes(e.kind))?'card':null;
}
/** Injected browser environment makes lifecycle and failure handling testable. */
export function createArenaAudio(win,onError=(_message)=>{}) {
  let options=audioPreferences(),activated=false,visible=true,available=true,disposed=false,music=null,musicUrl='',generation=0;
  const effects=new Set();
  function halt(media) {try{media.pause();media.removeAttribute('src');media.load();}catch{/* Best-effort cleanup. */}}
  function stopEffects(){for(const m of effects)halt(m);effects.clear();}
  function stopMusic(){if(music)halt(music);music=null;musicUrl='';generation++;}
  function permitted(){return !disposed&&activated&&visible&&available;}
  function play(media,token){
    try{const pending=media.play();pending?.catch(()=>{if(!disposed&&token===generation)onError('Audio could not play. Check your browser sound settings, then select Enable audio again.');});}
    catch{if(!disposed)onError('Audio is unavailable in this browser. Gameplay is unaffected.');}
  }
  function syncMusic(){
    if(!permitted()||!options.music||!options.musicVolume){stopMusic();return;}
    const track=ARENA_TRACKS.find(t=>t.id===options.track);
    if(musicUrl!==track.url){stopMusic();music=new win.Audio();music.preload='none';music.loop=true;music.src=track.url;musicUrl=track.url;
      const token=generation;music.onerror=()=>{if(!disposed&&token===generation)onError('The local music file could not load. Gameplay is unaffected.');};
    }
    music.volume=options.musicVolume;
    if(music.paused)play(music,generation);
  }
  return {
    configure(value){options=audioPreferences(value);if(!options.effects||!options.effectsVolume)stopEffects();else for(const m of effects)m.volume=options.effectsVolume;syncMusic();},
    // Must be called by a real click/keypress, never by a timer or on page load.
    activate(){if(disposed)return;activated=true;syncMusic();},
    cue(kind){
      if(!permitted()||!options.effects||!options.effectsVolume||!Object.hasOwn(ARENA_AUDIO,kind)||effects.size>=3)return false;
      const media=new win.Audio();media.preload='none';media.src=ARENA_AUDIO[kind];media.volume=options.effectsVolume;effects.add(media);
      const clean=()=>{effects.delete(media);halt(media);};media.onended=clean;media.onerror=clean;
      try{const pending=media.play();pending?.catch(clean);}catch{clean();}return true;
    },
    setVisible(value){visible=value===true;if(!visible)stopEffects();syncMusic();},
    setAvailable(value){available=value===true;if(!available)stopEffects();syncMusic();},
    stop(){activated=false;stopEffects();stopMusic();},
    dispose(){disposed=true;activated=false;stopEffects();stopMusic();}
  };
}
