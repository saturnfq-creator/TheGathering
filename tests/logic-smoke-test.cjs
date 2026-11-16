// Run: node tests/logic-smoke-test.cjs
// Lightweight smoke check for the JS queue and stale-event guard, without Android.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const code = fs.readFileSync(__dirname+'/../app/src/main/assets/app.js','utf8');
const fake = () => ({
  style:{setProperty(){}}, dataset:{}, children:[], classList:{add(){},remove(){},toggle(){},contains(){return false}},
  textContent:'',innerHTML:'',value:'',attributes:{},
  setAttribute(){},addEventListener(){},setPointerCapture(){},
  replaceChildren(...els){this.children=els},appendChild(el){this.children.push(el)},append(){},remove(){},
  querySelector(){return null},querySelectorAll(){return []},
  getBoundingClientRect(){return {left:0,top:0,width:100,height:50}},
  getContext(){return {fillRect(){},beginPath(){},moveTo(){},lineTo(){},closePath(){},fill(){},createLinearGradient(){return {addColorStop(){}}}}}
});
const nodes = {};
const get = s => nodes[s] ??= fake();
const calls = [];
const native = {
  playQueue:(a,b)=>calls.push(['playQueue',a,b]),
  selectTrack:id=>calls.push(['selectTrack',id]),
  setPlaying:playing=>calls.push(['setPlaying',playing]),
  seekTo:seconds=>calls.push(['seekTo',seconds]),
  reorderQueue:json=>calls.push(['reorderQueue',json])
};
const sandbox = {
  document:{querySelector:get,querySelectorAll:()=>[],createElement:()=>fake(),createDocumentFragment:()=>fake(),hidden:false,activeElement:fake(),addEventListener(){}},
  window:{AndroidBridge:native,devicePixelRatio:1},
  localStorage:{getItem:()=>null,setItem(){}},
  requestAnimationFrame(){},clearTimeout(){},setTimeout(){return 1},
  console,Intl,Map,Set,Math,Number,String,JSON,Date,URL,
};
sandbox.window.document=sandbox.document;
vm.createContext(sandbox);
vm.runInContext(code,sandbox);
vm.runInContext(`
  tracks = [
   {id:'a',artist:'X',title:'A',album:'One',uri:'content://a',duration:60,colors:DEFAULT_COLORS},
   {id:'b',artist:'X',title:'B',album:'One',uri:'content://b',duration:60,colors:DEFAULT_COLORS},
   {id:'c',artist:'Y',title:'C',album:'Two',uri:'content://c',duration:60,colors:DEFAULT_COLORS},
   {id:'d',artist:'Y',title:'D',album:'Two',uri:'content://d',duration:60,colors:DEFAULT_COLORS}
  ];
  lookup = new Map(tracks.map(t => [t.id,t]));
  order=['a','b','c','d'];current='b';nativeQueueReady=true;
  renderQueue=()=>{};toast=()=>{};
`,sandbox);
const expr = expression => vm.runInContext(expression,sandbox);
assert.equal(JSON.stringify(expr('upcomingIds()')),JSON.stringify(['c','d','a']));
expr('reorderUpcoming("a","c")');
assert.equal(JSON.stringify(expr('order')),JSON.stringify(['b','a','c','d']));
assert.deepEqual(calls.pop(),['reorderQueue',JSON.stringify(['b','a','c','d'])]);
// A callback from the previously selected track must not make the UI jump back.
expr('pendingNativeId="c";current="c";nativePlaybackState({id:"b",position:12,playWhenReady:true});');
assert.equal(expr('current'),'c');
assert.equal(expr('pendingNativeId'),'c');
expr('nativePlaybackState({id:"c",position:15,playWhenReady:true,duration:60});');
assert.equal(expr('pendingNativeId'),null);
assert.equal(expr('currentPosition'),15);
console.log('PASS: upcoming order, queue drag reorder, native synchronization, stale-event guard');
