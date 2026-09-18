// Execute the real page's TypeScript load/queue handlers without mounting a browser.
// Only Nuxt services and the small reactive state surface used here are substituted.
// API integration tests use this same consumer with real HTTP responses.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';

const file=new URL('../../app/pages/admin/game-catalogue.vue',import.meta.url);
const source=readFileSync(file,'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)?.[1];
assert.ok(source,'The game-catalogue page must contain its setup script.');
const compiled=ts.transpileModule(source+`
globalThis.cataloguePage={game,sets,query,selected,confirmed,busy,loading,error,job,visible,load,queue};
`,{fileName:'game-catalogue.ts',reportDiagnostics:true,
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}});
assert.equal(compiled.diagnostics?.filter(d=>d.category===ts.DiagnosticCategory.Error).length??0,0);

export function createCataloguePage(api) {
  const watchers=new WeakMap(),notices=[];
  function ref(initial) {
    let value=initial;
    const state={get value(){return value;},set value(next){
      const previous=value;value=next;
      if(!Object.is(next,previous))for(const callback of watchers.get(state)??[])callback(next,previous);
    }};
    return state;
  }
  const context={
    ref,computed:read=>({get value(){return read();}}),
    watch(state,callback){
      const list=watchers.get(state)??new Set();list.add(callback);watchers.set(state,list);
      return ()=>list.delete(callback);
    },
    useApi:()=>api,useNotice:()=>({show:message=>notices.push(message)}),
    errorMessage:error=>String(error?.message??error)
  };
  runInNewContext(compiled.outputText,context,{filename:file.pathname,timeout:1000});
  return {...context.cataloguePage,notices};
}
