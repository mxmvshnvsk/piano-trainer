import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

describe('service worker version isolation', () => {
  it('uses its own cached page while a newer version waits to activate', async () => {
    const listeners: Record<string, (event: unknown) => void> = {};
    const cacheNames = ['piano-v1-current','piano-v1-waiting'];
    const context = {
      URL,
      self: { registration:{scope:'https://example.com/piano-trainer/'}, addEventListener:(name:string, fn:(e:unknown)=>void)=>{ listeners[name]=fn; } },
      caches: { keys:async()=>cacheNames, open:async(name:string)=>({match:async(_request:unknown, options?:{ignoreVary:boolean})=>options?.ignoreVary ? name : undefined}) },
      fetch:()=>{throw new Error('must not need the network');},
    };
    vm.runInNewContext(readFileSync('src/sw-template.js','utf8').replace('__BUILD_HASH__','current'),context);
    let response: Promise<string> | undefined;
    listeners.fetch({request:{method:'GET',mode:'navigate',url:'https://example.com/piano-trainer/'},respondWith:(value:Promise<string>)=>{response=value;}});
    expect(await response).toBe('piano-v1-current');
  });
});
