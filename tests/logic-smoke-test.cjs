// Run: node tests/logic-smoke-test.cjs
// Lightweight smoke check for the JS queue and stale-event guard, without Android.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const code = fs.readFileSync(__dirname+'/../app/src/main/assets/app.js','utf8');
const fake = () => ({
  style:{setProperty(){},removeProperty(){}}, dataset:{}, children:[], classList:{add(){},remove(){},toggle(){},contains(){return false}},
  textContent:'',innerHTML:'',value:'',clientHeight:300,clientWidth:300,attributes:{},
  setAttribute(){},addEventListener(){},setPointerCapture(){},pause(){},load(){},
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
let testClock=10000;
const sandbox = {
  document:{querySelector:get,querySelectorAll:()=>[],createElement:()=>fake(),createDocumentFragment:()=>fake(),documentElement:fake(),hidden:false,activeElement:fake(),addEventListener(){}},
  window:{AndroidBridge:native,devicePixelRatio:1,addEventListener(){}},
  navigator:{hardwareConcurrency:8,deviceMemory:8},
  localStorage:{getItem:()=>null,setItem(){}},
  requestAnimationFrame(){return 1},cancelAnimationFrame(){},clearTimeout(){},setTimeout(){return 1},
  console,Intl,Map,Set,Math,Number,String,JSON,Date,URL,performance:{now:()=>testClock},
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
// Insert a single song next without stopping currently playing song.
expr('current="b";order=["b","a","c","d"];pendingNativeId=null;nativeQueueReady=true;');
calls.length=0;
assert.equal(expr('putNext("d")'),true);
assert.equal(JSON.stringify(expr('order')),JSON.stringify(['b','d','a','c']));
assert.deepEqual(calls.pop(),['reorderQueue',JSON.stringify(['b','d','a','c'])]);
// Move an entire album block immediately after the current track.
expr('moveAlbumNext(["c","a"])');
assert.equal(JSON.stringify(expr('order')),JSON.stringify(['b','c','a','d']));
assert.deepEqual(calls.pop(),['reorderQueue',JSON.stringify(['b','c','a','d'])]);
// Album playback must start on its first song and place the rest first.
expr('playEntireAlbum(["a","b"])');
assert.equal(expr('current'),'a');
assert.equal(JSON.stringify(expr('order')),JSON.stringify(['a','b','c','d']));
assert.equal(calls.pop()[0],'playQueue');
// Position between backend updates advances in fractional steps, not 650 ms jumps.
expr('pendingNativeId=null;nativePlaybackState({id:"a",position:4,playWhenReady:true,ready:true,buffering:false,duration:60})');
testClock+=420;
assert(Math.abs(expr('visiblePosition()')-4.42)<.01);
assert.equal(expr('groupLibrary("albums").length'),2);
// No favorites or blue focus ring: generated app must not retain obsolete UX.
const html=fs.readFileSync(__dirname+'/../app/src/main/assets/index.html','utf8');
assert(!html.includes('menuFavorite')&&!html.includes('id="favorite"'));
assert(!html.includes('ПЕРЕТАСКИВАЙ ЗА')&&!html.includes('Главная'));
assert(html.includes('data-tab="Плеер"'));
assert(html.includes('queue-drag-ghost'));

// Bottom-sheet states and Android back contract.
assert.equal(expr('sheetStage'),'closed');
expr('setQueueSheet("partial")');
assert.equal(expr('sheetStage'),'partial');
expr('setQueueSheet("full")');
assert.equal(expr('sheetStage'),'full');
assert.equal(expr('appNavigateBack()'),true);
assert.equal(expr('sheetStage'),'closed');
assert.equal(expr('appNavigateBack()'),false); // root is delegated to Android Activity
// The virtual deck maps depth offsets forward from the currently playing track.
expr('current="a";order=["a","b","c","d"];');
assert.equal(expr('deckIdAt(0)'),'a');
assert.equal(expr('deckIdAt(2)'),'c');
assert.equal(expr('deckIdAt(-1)'),null);
assert.equal(expr('deckIdAt(4)'),null);
expr('deckMode=true;deckDepth=1;');
assert.equal(expr('appNavigateBack()'),true); // escape depth browse without exiting Android
assert.equal(expr('deckMode'),false);
// UI contract: the classic X closures are gone, depth deck and native back exist.
assert(html.includes('id="queueGrab"'));
assert(!html.includes('id="close"'));
assert(!html.includes('id="closeLibrary"'));
assert(html.includes('.album.prev-card{transform:translate3d(-105%'));
const java=fs.readFileSync(__dirname+'/../app/src/main/java/com/thegathering/player/MainActivity.kt','utf8');
assert(java.includes('onBackPressedDispatcher.addCallback'));
assert(java.includes('window.appNavigateBack'));
assert(code.includes('queueList.setPointerCapture(e.pointerId)'));
assert(code.includes("queueList.addEventListener('lostpointercapture'"));
assert(code.includes('function paintDeck('));

// The 0.6 deck must advance at most one position per swipe, with no flick inertia.
expr('order=["a","b","c","d"];current="a";');
assert.equal(expr('Math.round(depthFromGesture({startDepth:0,dy:140}))'),1);
assert.equal(expr('depthFromGesture({startDepth:0,dy:4000})'),1);
assert.equal(expr('depthFromGesture({startDepth:2,dy:-4000})'),1);
assert.equal(expr('depthFromGesture({startDepth:0,dy:-4000})'),0);
assert(code.includes('if(deckMode){\n      paintDeck(deckDepth,false);\n      return;'));
assert(!code.includes('function paintDeckHorizontal('));
assert(code.includes('tapOffset:deckMode?Number('));
assert(code.includes('selectDeckCover(g.tapOffset)'));
assert(html.includes('id="deckTitle"') && code.includes('deckLabelNodes=new Map()'));
assert(!html.includes('filter:blur(19px);opacity:.55;\n  background:radial-gradient'));
assert(code.includes('lowPowerDevice?62:42'));
assert(html.includes('gatheringAuraBreath'));
console.log('PASS v0.6: queue, clock, slow bounded depth, tap-only selection, captions, glow, Android back');
