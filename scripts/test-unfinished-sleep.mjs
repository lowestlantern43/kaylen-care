import assert from 'node:assert/strict';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
globalThis.__sleepReact = React;
const result = await build({ entryPoints: ['src/UnfinishedSleepPrompt.jsx'], bundle:true, write:false, format:'esm', jsx:'transform', jsxFactory:'globalThis.__sleepReact.createElement', plugins:[{name:'react',setup(b){ b.onResolve({filter:/^react$/},()=>({path:'react',namespace:'test'})); b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export const useState=globalThis.__sleepReact.useState; export const useEffect=globalThis.__sleepReact.useEffect;'})); }}] });
const {default:Prompt}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
const original=Date.now;Date.now=()=>1800000000000;
try {
 const render=(age,busy=false)=>renderToStaticMarkup(React.createElement(Prompt,{startedAt:Date.now()-age,busy,onClear:()=>{throw Error('must not clear automatically')}}));
 assert.equal(render(13*3600000),'');
 assert.equal(render(-1000),'');
 assert.equal(render(NaN),'');
 const html=render(13*3600000+1,true);
 assert.match(html,/Enter wake-up time/);assert.match(html,/Clear unfinished sleep/);assert.match(html,/disabled/);
 console.log('PASS: thirteen-hour boundary, invalid/future dates, recovery choices, busy state, no automatic clearing');
} finally {Date.now=original;delete globalThis.__sleepReact;}

