'use strict';
// The Gathering 0.4: reversible gestures, magnetic queue sorting and native Media3 playback.
// Keep the four permanent cover layers; paint only transforms while dragging.
const $ = selector => document.querySelector(selector);
const native = window.AndroidBridge || null;
const audio = $('#audio');
const DEFAULT_COLORS = ['#a48ca5', '#918e78'];
const coverData = 'file:///android_asset/demo_cover.png';
let tracks = [
  {id:'demo:1',title:'Alien Blues',artist:'Vundabar',album:'Gawk',cover:coverData,duration:258,colors:['#8c8068','#c4a990']},
  {id:'demo:2',title:'Reptilia',artist:'The Strokes',album:'',duration:219,colors:['#ad5c50','#574547']},
  {id:'demo:3',title:'No Surprises',artist:'Radiohead',album:'',duration:229,colors:['#718d83','#c6a58b']},
  {id:'demo:4',title:'Space Song',artist:'Beach House',album:'',duration:320,colors:['#a47cba','#696b9a']},
  {id:'demo:5',title:'Chamber of Reflection',artist:'Mac DeMarco',album:'',duration:231,colors:['#b9a778','#668a8b']}
];
let lookup = new Map(tracks.map(t => [String(t.id), t]));
let order = tracks.map(t => String(t.id));
let current = order[0];
let playing = false;
let nativeQueueReady = false;
let pendingNativeId = null;
let playerState = null;
let lastNativeState = null;
let currentPosition = 0;
let history = [];
let shuffle = false;
let libraryMode = 'albums';
let searchTerm = '';
let stackAnimating = false;
let scrub = null;
let pendingSeek = null;
let lastWaveTime = 0;
let lastNativeStamp = 0;
let stackCards = null;
let stackTimer = null;
let queuedNavigation = 0;
let stackNeedsRebuild = false;
let activeAlbumKey = null;
let trackMenuId = null;
let lastDisplayedSecond = -1;
let importedCounter = 0;
let queueDisplayLimit = 65;
let titleMeasureFrame = 0;

function track(id = current) { return lookup.get(String(id)); }
function index() { return order.indexOf(String(current)); }
function fmt(seconds) {
  const s = Math.max(0, Number.isFinite(Number(seconds)) ? Math.floor(Number(seconds)) : 0);
  return Math.floor(s/60) + ':' + String(s%60).padStart(2,'0');
}
function esc(input) {
  return String(input == null ? '' : input).replace(/[&<>"']/g,
    c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.style.display = 'block';
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.style.display = 'none'; }, 2400);
}
function art(t, eager = false) {
  const colors = t.colors || DEFAULT_COLORS;
  const backing = '<div class="art" style="--a:' + esc(colors[0]) + ';--b:' + esc(colors[1]) + '"><span>♫</span></div>';
  const cover = t.cover || t.coverUri;
  return backing + (cover ? '<img loading="' + (eager ? 'eager' : 'lazy') + '" decoding="async" src="' + esc(cover) + '" alt="" onerror="this.remove()">' : '');
}
function updatePlay() {
  $('#play').innerHTML = playing
    ? '<svg viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>'
    : '<svg viewBox="0 0 24 24"><path d="M7 4 Q7 3 9 4 L20 11 Q22 12 20 13 L9 20 Q7 21 7 19Z"/></svg>';
  $('#play').setAttribute('aria-label', playing ? 'Пауза' : 'Воспроизвести');
}
function activeDuration() {
  const t = track();
  return Math.max(0,Number(playerState?.id === String(current) && playerState.duration > 0
    ? playerState.duration : (t?.duration || 0)) || 0);
}
function visiblePosition(now = performance.now()) {
  if (scrub) return scrub.progress * activeDuration();
  if (track()?.url && Number.isFinite(audio.currentTime)) return audio.currentTime;
  let pos = currentPosition;
  if (track()?.uri && playerState?.id === String(current) &&
      playerState.playWhenReady && playerState.ready && !playerState.buffering && lastNativeStamp) {
    pos += Math.max(0,Math.min(2,(now-lastNativeStamp)/1000));
  }
  const duration = activeDuration();
  return Math.max(0,duration>0 ? Math.min(duration,pos) : pos);
}
function updateTimes(now = performance.now()) {
  const t = track();if (!t) return;
  const duration = activeDuration();
  const seconds = visiblePosition(now);
  const wholeSecond = Math.floor(seconds);
  if (wholeSecond !== lastDisplayedSecond) {
    $('#elapsed').textContent = fmt(seconds);
    lastDisplayedSecond = wholeSecond;
  }
  $('#duration').textContent = fmt(duration);
  $('#timeline').setAttribute('aria-valuenow',String(Math.floor(seconds)));
  $('#timeline').setAttribute('aria-valuemax',String(Math.floor(duration)));
}
function updatePlayerChrome() {
  const t = track();if (!t) return;
  const label = $('#titleInner');
  label.textContent = t.artist + ' - ' + t.title;
  $('#title').classList.remove('marquee');
  label.style.removeProperty('--title-overflow');
  if (titleMeasureFrame) cancelAnimationFrame(titleMeasureFrame);
  titleMeasureFrame = requestAnimationFrame(updateTitleOverflow);
  lastDisplayedSecond=-1;
  updateTimes();
}
function updateTitleOverflow() {
  titleMeasureFrame = 0;
  const container=$('#title'), label=$('#titleInner');
  if(!container || !label)return;
  const excess=Math.max(0,label.scrollWidth-container.clientWidth);
  container.classList.toggle('marquee',excess>2);
  if(excess>2){
    label.style.setProperty('--title-overflow',excess+'px');
    label.style.animationDuration=Math.max(7,Math.min(16,6+excess/25))+'s';
  }
}
window.addEventListener('resize',()=>{
  if(titleMeasureFrame)cancelAnimationFrame(titleMeasureFrame);
  titleMeasureFrame=requestAnimationFrame(updateTitleOverflow);
});
function makeStackCard(id,role) {
  const card=document.createElement('div');
  card.className='album '+role;
  const item=track(id);
  if(item){card.dataset.id=String(item.id);card.innerHTML=art(item,role!=='back2');}
  return card;
}
function stackMarkup() {
  if(stackTimer){clearTimeout(stackTimer);stackTimer=null;}
  stackAnimating=false;
  stackNeedsRebuild=false;
  const n=order.length,p=index();
  if(!n || p<0)return;
  const at=offset=>order[(p+offset+n)%n];
  const cards={
    back2:makeStackCard(at(2),'back2'),
    back1:makeStackCard(at(1),'back1'),
    front:makeStackCard(current,'front'),
    prev:makeStackCard(at(-1),'prev-card')
  };
  $('#stack').replaceChildren(cards.back2,cards.back1,cards.front,cards.prev);
  stackCards=cards;
  updatePlayerChrome();
}
function setCardRole(card,role,recycle=false) {
  card.className='album '+role+(recycle?' recycle':'');
  card.style.transform='';
  card.style.opacity='';
}
function recycleCard(card,id,role) {
  const t=track(id);
  setCardRole(card,role,true);
  if(t && card.dataset.id!==String(t.id)) {
    card.dataset.id=String(t.id);
    card.innerHTML=art(t,role==='prev-card');
  }
  requestAnimationFrame(()=>{
    if(card.isConnected)card.classList.remove('recycle');
  });
}
function updateStack(direction=0) {
  updatePlayerChrome();
  if(!direction || !stackCards || order.length<2){stackMarkup();return;}
  if(stackAnimating){stackNeedsRebuild=true;return;}
  const old=stackCards;
  const match=direction>0 ? old.back1.dataset.id===String(current) : old.prev.dataset.id===String(current);
  if(!match){stackMarkup();return;}
  stackAnimating=true;
  if(swipeFrame){cancelAnimationFrame(swipeFrame);swipeFrame=0;}
  const pos=index(),n=order.length;
  const at=offset=>order[(pos+offset+n)%n];
  if(direction>0){
    // Both the incoming cover and the second card already have decoded DOM images.
    // No front-card replacement while the animation is in progress.
    old.front.getBoundingClientRect();
    setCardRole(old.front,'leaving-left');
    setCardRole(old.back1,'front');
    setCardRole(old.back2,'back1');
    recycleCard(old.prev,at(2),'back2');
    stackCards={front:old.back1,back1:old.back2,back2:old.prev,prev:old.front};
  }else{
    old.front.getBoundingClientRect();
    setCardRole(old.prev,'front');
    setCardRole(old.front,'back1');
    setCardRole(old.back1,'back2');
    setCardRole(old.back2,'prev-card',true);
    stackCards={front:old.prev,back1:old.front,back2:old.back1,prev:old.back2};
  }
  stackTimer=setTimeout(()=>{
    stackTimer=null;
    if(!stackCards)return;
    if(direction>0){
      recycleCard(stackCards.prev,at(-1),'prev-card');
    }else{
      recycleCard(stackCards.prev,at(-1),'prev-card');
    }
    stackAnimating=false;
    if(stackNeedsRebuild || stackCards.front.dataset.id!==String(current))stackMarkup();
    if(queuedNavigation){
      const dir=queuedNavigation;
      queuedNavigation=0;
      setTimeout(()=>dir>0?next():prev(),0);
    }
  },540);
}
function nativePlaylist() {
  return order.map(id => track(id)).filter(t => t && t.uri).map(t => ({
    id:String(t.id),uri:t.uri,title:t.title,artist:t.artist,album:t.album || ''
  }));
}
function choose(id, direction = 1, fromNative = false) {
  id = String(id);
  if (!lookup.has(id)) return;
  const old = String(current);
  const changed = id !== old;
  if (changed) {
    if (!fromNative && direction > 0) history.push(old);
    current = id;
    currentPosition = 0;
    pendingSeek=null;
    lastNativeStamp=0;
    playerState = null;
  }
  const t = track();
  if (!fromNative) {
    if (t.uri && native) {
      pendingNativeId = id;
      audio.pause();
      audio.removeAttribute('src');
      if (!nativeQueueReady) {
        nativeQueueReady = true;
        native.playQueue(JSON.stringify(nativePlaylist()), id);
      } else {
        native.selectTrack(id);
      }
      playing = true; // provisional until Media3 reports its actual state
    } else if (t.url) {
      pendingNativeId = null;
      if (native) native.setPlaying(false);
      nativeQueueReady=false;
      audio.src = t.url;
      audio.load();
      playing = true;
      audio.play().catch(() => { playing = false; updatePlay(); toast('Не удалось открыть аудиофайл'); });
    } else {
      playing = false;
      toast('Демо-обложка. Выбери настоящую музыку из библиотеки');
    }
  }
  if (changed) updateStack(direction);
  else { updateTimes(); }
  updatePlay();
  renderQueue();
}
function next() {
  if(stackAnimating){queuedNavigation=1;return;}
  if (order.length < 2) return;
  let id;
  if (shuffle) {
    const rest = order.filter(x => x !== current);
    id = rest[Math.floor(Math.random()*rest.length)];
  } else id = order[(index()+1)%order.length];
  choose(id,1);
}
function prev() {
  if(stackAnimating){queuedNavigation=-1;return;}
  if (order.length < 2) return;
  const candidate = history.length ? history.pop() : order[(index()-1+order.length)%order.length];
  // A reverse selection must not push the song being left onto history.
  choose(candidate,-1);
}
function upcomingIds() {
  const pos = index();
  if (pos < 0) return [];
  return order.slice(pos+1).concat(order.slice(0,pos));
}
function queueItem(t, isCurrent = false) {
  const row = document.createElement('div');
  row.className = 'queue-item' + (isCurrent ? ' queue-current' : '');
  row.dataset.id = String(t.id);
  row.innerHTML = '<div class="queue-cover">' + art(t) + '</div>' +
    '<div class="queue-label"><strong>' + esc(t.artist + ' — ' + t.title) +
    '</strong><small>' + esc(t.album || '') + ' · ' + fmt(t.duration) + '</small></div>' +
    (isCurrent ? '<span class="queue-playing">◖))</span>' : '<span class="handle" aria-label="Перетащить для изменения порядка">≡</span>');
  if (!isCurrent) row.querySelector('.queue-label').addEventListener('click', () => {
    choose(t.id,1);
    $('#overlay').classList.remove('open');
  });
  return row;
}
function renderQueue() {
  // Do not create/decode hundreds of cover images while the sheet is closed.
  if (!$('#overlay').classList.contains('open')) return;
  const now = $('#queueNow');
  const list = $('#queueList');
  const t = track();
  if (!t) return;
  now.replaceChildren(queueItem(t,true));
  list.replaceChildren();
  const upcoming = upcomingIds();
  const fragment = document.createDocumentFragment();
  upcoming.slice(0,queueDisplayLimit).forEach(id => {
    const item = track(id); if (item) fragment.appendChild(queueItem(item));
  });
  if (upcoming.length > queueDisplayLimit) {
    const more = document.createElement('button');
    more.className = 'queue-more';
    more.textContent = 'Показать ещё (' + (upcoming.length - queueDisplayLimit) + ')';
    more.onclick = () => { queueDisplayLimit += 75; renderQueue(); };
    fragment.appendChild(more);
  }
  list.appendChild(fragment);
  $('#queueCount').textContent = 'В очереди: ' + upcoming.length;
}
function refreshStackForQueue() {
  if(stackAnimating)stackNeedsRebuild=true;else stackMarkup();
}
function syncQueueToNative() {
  if(!native || !nativeQueueReady || !track()?.uri)return;
  const ids=order.filter(id=>!!track(id)?.uri);
  native.reorderQueue(JSON.stringify(ids));
}
function putNext(id) {
  id=String(id);
  if(!lookup.has(id))return false;
  if(id===String(current)){toast('Этот трек уже играет');return false;}
  const rest=upcomingIds().filter(x=>x!==id);
  order=[String(current),id,...rest];
  refreshStackForQueue();
  syncQueueToNative();
  renderQueue();
  toast('Будет играть следующим');
  return true;
}
function sortAlbumItems(items) {
  return [...items].sort((a,b)=>(a.trackNumber||0)-(b.trackNumber||0)||
    a.title.localeCompare(b.title,'ru',{numeric:true}));
}
function moveAlbumNext(ids) {
  const unique=[...new Set(ids.map(String))].filter(id=>lookup.has(id)&&id!==String(current));
  if(!unique.length)return;
  const rest=upcomingIds().filter(id=>!unique.includes(id));
  order=[String(current),...unique,...rest];
  refreshStackForQueue();
  syncQueueToNative();
  renderQueue();
  toast('Альбом добавлен следующим в очередь');
}
function playEntireAlbum(ids) {
  const unique=[...new Set(ids.map(String))].filter(id=>lookup.has(id));
  if(!unique.length)return;
  const rest=order.filter(id=>!unique.includes(id));
  order=[...unique,...rest];
  current=unique[0];currentPosition=0;lastNativeStamp=0;playerState=null;pendingSeek=null;
  pendingNativeId=String(current);
  stackMarkup();
  updatePlay();
  renderQueue();
  const t=track();
  if(t?.uri && native){
    audio.pause();
    nativeQueueReady=true;
    native.playQueue(JSON.stringify(nativePlaylist()),String(current));
    playing=true;
  }else if(t?.url){
    nativeQueueReady=false;
    if(native)native.setPlaying(false);
    audio.pause();audio.src=t.url;audio.load();
    audio.play().then(()=>{playing=true;updatePlay();}).catch(()=>{playing=false;updatePlay();toast('Не удалось открыть альбом');});
  }
  updatePlay();
  closeLibrary();
}
function commitUpcomingOrder(future) {
  const expected=upcomingIds();
  if(future.length!==expected.length || new Set(future).size!==expected.length ||
    future.some(id=>!expected.includes(id)))return false;
  if(future.every((id,i)=>id===expected[i]))return false;
  order=[String(current),...future];
  refreshStackForQueue();
  syncQueueToNative();
  renderQueue();
  // Intentionally no toast: the animated queue itself confirms the change.
  return true;
}
function reorderUpcoming(draggedId, hoveredId) {
  const future=upcomingIds();
  const from=future.indexOf(String(draggedId));
  const to=future.indexOf(String(hoveredId));
  if(from<0||to<0||from===to)return false;
  future.splice(to,0,future.splice(from,1)[0]);
  return commitUpcomingOrder(future);
}
let dragQueue=null;
const queueList=$('#queueList');
const queueRowSelector='.queue-item';
function queueRows(){return Array.from(queueList.querySelectorAll(queueRowSelector));}
function expandQueueForDrag(){
  const more=queueList.querySelector('.queue-more');
  if(more){
    // Add rows rather than rebuilding: pointer capture and the placeholder survive.
    const upcoming=upcomingIds();
    const from=queueRows().length;
    const until=Math.min(upcoming.length,from+65);
    const fragment=document.createDocumentFragment();
    for(let i=from;i<until;i++){
      const t=track(upcoming[i]); if(t)fragment.appendChild(queueItem(t));
    }
    queueList.insertBefore(fragment,more);
    queueDisplayLimit=Math.max(queueDisplayLimit,until);
    if(until>=upcoming.length)more.remove();
    else more.textContent='Показать ещё ('+(upcoming.length-until)+')';
  }
}
function animateQueueShift(before){
  // FLIP technique: the other rows slide into the gap under the held track.
  for(const row of queueRows()){
    if(row===dragQueue?.row)continue;
    const first=before.get(row);
    if(!first)continue;
    const delta=first.top-row.getBoundingClientRect().top;
    if(Math.abs(delta)<.5)continue;
    if(typeof row.animate==='function'){
      row.animate([{transform:`translateY(${delta}px)`},{transform:'translateY(0)'}],{
        duration:170,easing:'cubic-bezier(.2,.75,.2,1)'
      });
    }
  }
}
function repositionQueueGap(){
  const drag=dragQueue;
  if(!drag)return;
  const y=drag.y;
  const all=queueRows();
  const rows=all.filter(row=>row!==drag.row);
  const firstOffset=all.length ? all[0].offsetTop : 0;
  const listTop=queueList.getBoundingClientRect().top-queueList.scrollTop;
  let target=null;
  for(const row of rows){
    // offsetTop represents layout, not the temporary FLIP translation.
    const center=listTop+(row.offsetTop-firstOffset)+row.offsetHeight/2;
    if(y<center){target=row;break;}
  }
  if(target===drag.row.nextElementSibling || (!target && drag.row===all[all.length-1]))return;
  for(const row of all)row.getAnimations?.().forEach(a=>a.cancel());
  const before=new Map(all.map(row=>[row,row.getBoundingClientRect()]));
  if(target)queueList.insertBefore(drag.row,target);
  else {
    const more=queueList.querySelector('.queue-more');
    queueList.insertBefore(drag.row,more||null);
  }
  animateQueueShift(before);
}
function queueScrollTick(){
  const drag=dragQueue;
  if(!drag)return;
  const rect=queueList.getBoundingClientRect();
  const edge=Math.min(92,rect.height*.23);
  let amount=0;
  if(drag.y<rect.top+edge) amount=-Math.min(22,2+(rect.top+edge-drag.y)/edge*19);
  else if(drag.y>rect.bottom-edge)amount=Math.min(22,2+(drag.y-(rect.bottom-edge))/edge*19);
  if(amount){
    const old=queueList.scrollTop;
    queueList.scrollTop+=amount;
    if(amount>0 && queueList.scrollHeight-queueList.clientHeight-queueList.scrollTop<170)
      expandQueueForDrag();
    if(old!==queueList.scrollTop)repositionQueueGap();
  }
  drag.frame=requestAnimationFrame(queueScrollTick);
}
function paintQueueGhost(){
  const drag=dragQueue;
  if(!drag)return;
  drag.ghost.style.transform=`translate3d(0,${drag.y-drag.startY}px,0) scale(1.018)`;
}
function startQueueDrag(e,handle,row){
  const rect=row.getBoundingClientRect();
  const ghost=row.cloneNode(true);
  ghost.classList.add('queue-drag-ghost');
  ghost.classList.remove('drop-gap');
  Object.assign(ghost.style,{left:rect.left+'px',top:rect.top+'px',width:rect.width+'px',height:rect.height+'px'});
  $('#overlay').appendChild(ghost);
  dragQueue={id:row.dataset.id,pointer:e.pointerId,row,handle,ghost,
    y:e.clientY,startY:e.clientY,frame:0,startScrollTop:queueList.scrollTop};
  row.classList.add('drop-gap');
  handle.setPointerCapture(e.pointerId);
  dragQueue.frame=requestAnimationFrame(queueScrollTick);
}
queueList.addEventListener('pointerdown',e=>{
  const handle=e.target.closest('.handle');
  if(!handle||dragQueue)return;
  const row=handle.closest('.queue-item');
  if(!row)return;
  startQueueDrag(e,handle,row);
  e.preventDefault();
});
queueList.addEventListener('pointermove',e=>{
  if(!dragQueue||dragQueue.pointer!==e.pointerId)return;
  dragQueue.y=e.clientY;
  paintQueueGhost();
  repositionQueueGap();
  e.preventDefault();
});
function finishQueueDrag(cancelled){
  const drag=dragQueue;
  if(!drag)return;
  cancelAnimationFrame(drag.frame);
  drag.ghost.remove();
  drag.row.classList.remove('drop-gap');
  dragQueue=null;
  if(!cancelled){
    const visibleIds=queueRows().map(row=>row.dataset.id);
    const expected=upcomingIds();
    const visibleSet=new Set(visibleIds);
    // Keep unrendered tracks, maintaining the positions of the loaded queue.
    const remaining=expected.filter(id=>!visibleSet.has(id));
    commitUpcomingOrder([...visibleIds,...remaining]);
  }else renderQueue();
}
queueList.addEventListener('pointerup',e=>{
  if(dragQueue?.pointer===e.pointerId)finishQueueDrag(false);
});
queueList.addEventListener('pointercancel',e=>{
  if(dragQueue?.pointer===e.pointerId)finishQueueDrag(true);
});
// A drag never changes state until pointerup; Android receives the same seek time.
function relativeScrub(e) {
  const rect = $('#timeline').getBoundingClientRect();
  return Math.max(0,Math.min(1,(e.clientX-rect.left)/Math.max(1,rect.width)));
}
const timeline = $('#timeline');
timeline.addEventListener('pointerdown', e => {
  scrub = {pointer:e.pointerId,progress:relativeScrub(e)};
  timeline.setPointerCapture(e.pointerId);
  updateTimes();
  e.preventDefault();
});
timeline.addEventListener('pointermove', e => {
  if (!scrub || e.pointerId !== scrub.pointer) return;
  scrub.progress = relativeScrub(e);
  lastDisplayedSecond = -1;
  updateTimes();
});
timeline.addEventListener('pointerup', e => {
  if (!scrub || e.pointerId !== scrub.pointer) return;
  const duration = (playerState?.id === String(current) && playerState.duration > 0)
    ? playerState.duration : (track()?.duration || 0);
  const seconds = Math.max(0,Math.min(duration,scrub.progress * duration));
  scrub = null;
  currentPosition = seconds;
  pendingSeek={id:String(current),target:seconds,until:performance.now()+1600};
  lastNativeStamp=performance.now();
  if (track()?.uri && native) native.seekTo(seconds);
  else if (track()?.url && Number.isFinite(audio.duration)) audio.currentTime = seconds;
  lastDisplayedSecond = -1;
  updateTimes();
});
timeline.addEventListener('pointercancel', () => { scrub = null; updateTimes(); });

$('#play').onclick = () => {
  const t = track(); if (!t) return;
  if (t.uri && native) {
    if (!nativeQueueReady) {
      nativeQueueReady = true;
      native.playQueue(JSON.stringify(nativePlaylist()),String(current));
      playing = true;
    } else {
      native.setPlaying(!playing);
      playing = !playing;
    }
  } else if (t.url) {
    if (audio.paused) {
      playing = true;
      audio.play().catch(() => { playing = false; updatePlay(); toast('Не удалось воспроизвести'); });
    } else { audio.pause(); playing = false; }
  } else toast('Открой «Библиотека» и выбери песню');
  updatePlay();
};
$('#shuffle').onclick = () => {
  shuffle = !shuffle;
  $('#shuffle').classList.toggle('shuffle-on',shuffle);
  toast(shuffle ? 'Перемешивание при ручном переключении' : 'Обычный порядок');
};
$('#device').onclick = () => toast('Воспроизведение на этом устройстве');
$('#queueOpen').onclick = () => { queueDisplayLimit=65;$('#overlay').classList.add('open');renderQueue(); };
$('#close').onclick = () => $('#overlay').classList.remove('open');
$('#overlay').addEventListener('click', e => {
  if (e.target === $('#overlay')) $('#overlay').classList.remove('open');
});

const stack = $('#stack');
let swipe=null;
let swipeFrame=0;
function paintCoverGesture(){
  swipeFrame=0;
  const g=swipe;
  if(!g || stackAnimating || !stackCards)return;
  const width=Math.max(1,stack.getBoundingClientRect().width);
  const dx=Math.max(-width*1.15,Math.min(width*1.15,g.dx));
  const progress=Math.min(1,Math.abs(dx)/width);
  const front=stackCards.front,back1=stackCards.back1,back2=stackCards.back2,prevCard=stackCards.prev;
  g.painted=true;
  const panels=[front,back1,back2,prevCard];
  for(const panel of panels)panel.classList.add('gesture');
  if(dx<0){
    // Next: finger pulls current artwork left; the next artwork emerges beneath it.
    front.style.transform=`translate3d(${dx}px,0,0) rotate(${-progress*8}deg) scale(${1-.06*progress})`;
    front.style.opacity=String(1-.36*progress);
    back1.style.transform=`translate3d(0,${-8*(1-progress)}%,0) scale(${.95+.05*progress})`;
    back1.style.opacity=String(.91+.09*progress);
    back2.style.transform=`translate3d(0,${-15+7*progress}%,0) scale(${.89+.06*progress})`;
    prevCard.style.transform='';prevCard.style.opacity='';
  }else{
    // Previous: the same card returns from the right, following the finger.
    const incoming=prevCard;
    incoming.style.transform=`translate3d(${(1-progress)*105}%,0,0) rotate(${(1-progress)*8}deg) scale(${.94+.06*progress})`;
    incoming.style.opacity=String(progress);
    front.style.transform=`translate3d(0,${-8*progress}%,0) scale(${1-.05*progress})`;
    front.style.opacity=String(1-.09*progress);
    back1.style.transform=`translate3d(0,${-8-7*progress}%,0) scale(${.95-.06*progress})`;
    back1.style.opacity=String(.91-.22*progress);
    back2.style.transform='';back2.style.opacity='';
  }
}
function resetCoverGesture(){
  if(swipeFrame){cancelAnimationFrame(swipeFrame);swipeFrame=0;}
  if(!stackCards)return;
  const panels=Object.values(stackCards);
  // Commit the dragged transforms before handing motion back to CSS transitions.
  stack.getBoundingClientRect();
  panels.forEach(card=>{
    card.classList.remove('gesture');
    card.style.transform='';
    card.style.opacity='';
  });
}
stack.addEventListener('pointerdown',e=>{
  if(e.isPrimary===false || stackAnimating || !stackCards)return;
  swipe={pointer:e.pointerId,x:e.clientX,y:e.clientY,dx:0,dy:0,painted:false};
  stack.setPointerCapture(e.pointerId);
});
stack.addEventListener('pointermove',e=>{
  const g=swipe;
  if(!g||e.pointerId!==g.pointer||stackAnimating)return;
  g.dx=e.clientX-g.x;
  g.dy=e.clientY-g.y;
  if(Math.abs(g.dx)<=6 || Math.abs(g.dx)<Math.abs(g.dy)*1.2)return;
  if(!swipeFrame)swipeFrame=requestAnimationFrame(paintCoverGesture);
});
stack.addEventListener('pointerup',e=>{
  const g=swipe;
  if(!g||g.pointer!==e.pointerId)return;
  g.dx=e.clientX-g.x;g.dy=e.clientY-g.y;
  if(swipeFrame){cancelAnimationFrame(swipeFrame);swipeFrame=0;}
  if(Math.abs(g.dx)>6&&Math.abs(g.dx)>Math.abs(g.dy)*1.2)paintCoverGesture();
  swipe=null;
  const accepted=Math.abs(g.dx)>Math.max(45,stack.clientWidth*.16) &&
    Math.abs(g.dx)>Math.abs(g.dy)*1.1;
  if(accepted){
    // updateStack now animates FROM the position under the finger.
    if(g.dx<0)next();else prev();
  }else resetCoverGesture();
});
stack.addEventListener('pointercancel',()=>{swipe=null;resetCoverGesture();});
document.addEventListener('keydown', e => {
  if ($('#overlay').classList.contains('open')) return;
  if (e.key==='ArrowLeft') next();
  if (e.key==='ArrowRight') prev();
  if (e.key===' ' && !['INPUT','TEXTAREA'].includes(document.activeElement?.tagName)) {
    e.preventDefault();$('#play').click();
  }
});

function nativePlaybackState(state) {
  if (!state || typeof state !== 'object') return;
  lastNativeState = state;
  const itemId = String(state.id || '');
  // Ignore stale callbacks from an older selection during rapid swipe commands.
  if (pendingNativeId && itemId !== pendingNativeId) return;
  if (pendingNativeId && itemId === pendingNativeId) pendingNativeId = null;
  if (itemId && track(itemId)) {
    nativeQueueReady = true;
    if (current !== itemId && !track()?.url) {
      const oldIndex=index();
      const newIndex=order.indexOf(itemId);
      const direction=(newIndex===(oldIndex+1)%order.length)?1:
        (oldIndex===(newIndex+1)%order.length)?-1:0;
      current = itemId;
      currentPosition = 0;
      playerState = null;
      pendingSeek=null;
      updateStack(direction); // also animate native auto-next when it is adjacent
      renderQueue();
    }
  }
  if (track()?.uri && itemId === String(current)) {
    playerState = {...state,id:itemId};
    if (!scrub) {
      const incoming=Math.max(0,Number(state.position)||0);
      const seeking=pendingSeek?.id===itemId && performance.now()<pendingSeek.until &&
        Math.abs(incoming-pendingSeek.target)>1.75;
      if(!seeking){pendingSeek=null;currentPosition=incoming;lastNativeStamp=performance.now();}
    }
    playing = !!state.playWhenReady;
    updatePlay();
    updateTimes();
  }
}
function nativePlaybackError(message) {
  playing = false;
  updatePlay();
  toast(String(message || 'Ошибка воспроизведения'));
}
window.nativePlaybackState = nativePlaybackState;
window.nativePlaybackError = nativePlaybackError;

// Unified library: search above Albums / Artists / Tracks, with a tile-based album browser.
function libraryRow(t) {
  const row=document.createElement('div');row.className='library-row';
  const main=document.createElement('button');main.className='lib-row-main';
  main.innerHTML='<span class="lib-cover">'+art(t)+'</span><span class="lib-track-info"><strong>'+esc(t.artist+' — '+t.title)+
    '</strong><small>'+esc(t.album||'Без альбома')+' · '+fmt(t.duration)+'</small></span>';
  main.onclick=()=>{choose(t.id,1);closeLibrary();};
  const menu=document.createElement('button');menu.className='lib-more';menu.type='button';
  menu.setAttribute('aria-label','Действия с треком '+t.title);menu.textContent='⋮';
  menu.onclick=e=>{e.stopPropagation();openTrackMenu(t.id);};
  row.append(main,menu);return row;
}
function albumKey(t){return Number(t.albumId)>0?'album:'+t.albumId:'fallback:'+t.artist+'::'+(t.album||'Без альбома');}
function groupLibrary(mode) {
  const groups=new Map();
  for(const t of tracks){
    if(!t.uri&&!t.url)continue;
    const key=mode==='albums'?albumKey(t):t.artist;
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(t);
  }
  const output=[...groups.values()];
  const collator=new Intl.Collator('ru',{numeric:true,sensitivity:'base'});
  output.sort((a,b)=>collator.compare(mode==='albums'?(a[0].album||'Без альбома'):a[0].artist,
    mode==='albums'?(b[0].album||'Без альбома'):b[0].artist));
  return output;
}
function createAlbumTile(items) {
  const t=items[0];
  const tile=document.createElement('button');tile.className='album-tile';tile.type='button';
  tile.innerHTML='<span class="album-tile-art">'+art(t)+'</span><strong>'+esc(t.album||'Без альбома')+
    '</strong><small>'+esc(t.artist)+' · '+items.length+' тр.</small>';
  tile.onclick=()=>openAlbum(items);
  return tile;
}
function appendBatched(box,items,make,chunk=80) {
  let shown=0;
  const more=document.createElement('button');more.className='queue-more';
  const add=()=>{
    more.remove();
    const fragment=document.createDocumentFragment();
    const until=Math.min(items.length,shown+chunk);
    for(;shown<until;shown++)fragment.appendChild(make(items[shown]));
    box.append(fragment);
    if(shown<items.length){more.textContent='Показать ещё ('+(items.length-shown)+')';box.append(more);}
  };
  more.onclick=add;add();
}
function openAlbum(items) {
  const songs=sortAlbumItems(items);
  if(!songs.length)return;
  activeAlbumKey=albumKey(songs[0]);
  $('#libraryBrowse').hidden=true;
  $('#albumDetail').hidden=false;
  const root=$('#albumDetailBody');root.replaceChildren();
  const t=songs[0];
  const hero=document.createElement('div');hero.className='album-hero';
  hero.innerHTML='<span class="album-tile-art">'+art(t,true)+'</span><div><h3>'+esc(t.album||'Без альбома')+
    '</h3><p>'+esc(t.artist)+'<br>'+songs.length+' треков</p></div>';
  const actions=document.createElement('div');actions.className='album-detail-actions';
  const play=document.createElement('button');play.className='album-play';play.textContent='▶ Слушать альбом';
  play.onclick=()=>playEntireAlbum(songs.map(x=>x.id));
  const nextButton=document.createElement('button');nextButton.className='album-queue';
  nextButton.textContent='＋ Играть следующим';nextButton.onclick=()=>moveAlbumNext(songs.map(x=>x.id));
  actions.append(play,nextButton);
  const list=document.createElement('div');list.className='album-tracks';
  songs.forEach(song=>list.append(libraryRow(song)));
  root.append(hero,actions,list);
  $('#libraryPanel').scrollTop=0;
}
function closeAlbum(){activeAlbumKey=null;$('#albumDetail').hidden=true;$('#libraryBrowse').hidden=false;}
function renderSearchMatches() {
  const box=$('#nativeLibraryList');box.replaceChildren();
  const term=searchTerm.trim().toLocaleLowerCase('ru');
  $('#libraryTabs').hidden=!!term;
  if(!term){renderNativeLibrary(libraryMode);return;}
  const matches=tracks.filter(t=>(t.uri||t.url)&&((t.title||'')+' '+(t.artist||'')+' '+(t.album||''))
    .toLocaleLowerCase('ru').includes(term));
  if(!matches.length){box.innerHTML='<p class="muted">Ничего не найдено. Попробуй другой запрос.</p>';return;}
  const header=document.createElement('p');header.className='muted';
  header.textContent='Найдено треков: '+matches.length;box.append(header);
  appendBatched(box,matches,t=>libraryRow(t),90);
}
function renderNativeLibrary(mode=libraryMode) {
  libraryMode=mode;
  $('#panelHeading').textContent='Библиотека';
  if(activeAlbumKey)closeAlbum();
  $('#libraryTabs').hidden=!!searchTerm.trim();
  document.querySelectorAll('.lib-tab').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));
  if(searchTerm.trim()){renderSearchMatches();return;}
  const box=$('#nativeLibraryList');box.replaceChildren();
  const available=tracks.filter(t=>t.uri||t.url);
  if(!available.length){box.innerHTML='<p class="muted">Музыка не найдена. Проверь разрешение на аудиофайлы.</p>';return;}
  if(mode==='tracks'){
    const sorted=[...available].sort((a,b)=>(a.artist+' '+a.title).localeCompare(b.artist+' '+b.title,'ru'));
    appendBatched(box,sorted,libraryRow,90);return;
  }
  const groups=groupLibrary(mode);
  if(mode==='albums'){
    const grid=document.createElement('div');grid.className='album-grid';box.append(grid);
    appendBatched(grid,groups,createAlbumTile,72);return;
  }
  // Artists keep their collapsible track lists; albums are always two-column tiles.
  appendBatched(box,groups,items=>{
    const t=items[0];
    const details=document.createElement('details');details.className='library-group';
    const header=document.createElement('summary');
    header.innerHTML='<span class="lib-cover">'+art(t)+'</span><span class="group-label"><strong>'+esc(t.artist)+
      '</strong><small>'+items.length+' треков</small></span><span class="group-arrow">⌄</span>';
    const list=document.createElement('div');list.className='group-tracks';
    details.append(header,list);
    details.addEventListener('toggle',()=>{
      if(details.open && !list.childElementCount){
        sortAlbumItems(items).forEach(t=>list.append(libraryRow(t)));
      }
    });
    return details;
  },70);
}
function openTrackMenu(id){
  const t=track(id);if(!t)return;
  trackMenuId=String(id);
  $('#menuTrackHeading').textContent=t.artist+' — '+t.title;
  $('#trackMenu').classList.add('open');
  $('#trackMenu').setAttribute('aria-hidden','false');
}
function closeTrackMenu(){
  trackMenuId=null;$('#trackMenu').classList.remove('open');$('#trackMenu').setAttribute('aria-hidden','true');
}
$('#menuClose').onclick=closeTrackMenu;
$('#trackMenu').addEventListener('click',e=>{if(e.target===$('#trackMenu'))closeTrackMenu();});
$('#menuPlayNext').onclick=()=>{const id=trackMenuId;closeTrackMenu();if(id)putNext(id);};
$('#menuPlayNow').onclick=()=>{const id=trackMenuId;closeTrackMenu();if(id){choose(id,1);closeLibrary();}};
function closeLibrary(){
  closeTrackMenu();closeAlbum();$('#libraryPanel').classList.remove('open');
  document.querySelectorAll('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.tab==='Плеер'));
}
document.querySelectorAll('.nav-item').forEach(button=>button.addEventListener('click',()=>{
  const tab=button.dataset.tab;
  if(tab==='Библиотека'){
    document.querySelectorAll('.nav-item').forEach(b=>b.classList.toggle('active',b===button));
    $('#libraryPanel').classList.add('open');
    renderNativeLibrary();
  }else if(tab==='Плеер')closeLibrary();
  else toast('Профиль появится в следующей версии');
}));
document.querySelectorAll('.lib-tab').forEach(button=>button.onclick=()=>renderNativeLibrary(button.dataset.mode));
$('#closeLibrary').onclick=closeLibrary;
$('#albumBack').onclick=closeAlbum;
$('#librarySearch').addEventListener('input',e=>{
  searchTerm=e.target.value;
  $('#clearSearch').hidden=!searchTerm;
  renderSearchMatches();
});
$('#clearSearch').onclick=()=>{
  $('#librarySearch').value='';searchTerm='';$('#clearSearch').hidden=true;
  renderNativeLibrary(libraryMode);$('#librarySearch').focus();
};
function nativeLibraryLoaded(items) {
  if (!Array.isArray(items) || !items.length) {
    toast('Не найдены аудиофайлы — проверь разрешение');
    return;
  }
  tracks = items.map(item=>({
    id:String(item.id),title:item.title||'Без названия',artist:item.artist||'Неизвестный исполнитель',
    album:item.album||'Без альбома',albumId:item.albumId,trackNumber:Number(item.trackNumber)||0,
    duration:Number(item.duration)||0,uri:item.uri,coverUri:item.coverUri||'',colors:DEFAULT_COLORS
  }));
  lookup = new Map(tracks.map(t=>[String(t.id),t]));
  order = tracks.map(t=>String(t.id));
  if (!lookup.has(current)) current=order[0];
  if (lastNativeState?.id && lookup.has(String(lastNativeState.id))) {
    current=String(lastNativeState.id);nativeQueueReady=true;
  }
  currentPosition=0;history=[];pendingNativeId=null;
  if(stackTimer)clearTimeout(stackTimer);
  stackAnimating=false;
  stackMarkup();
  renderQueue();
  updatePlay();
  if ($('#libraryPanel').classList.contains('open')) {
    if(activeAlbumKey){const items=groupLibrary('albums').find(g=>albumKey(g[0])===activeAlbumKey);if(items)openAlbum(items);else renderNativeLibrary();}
    else renderNativeLibrary();
  }
  if (lastNativeState) nativePlaybackState(lastNativeState);
  toast('Найдено треков: '+tracks.length);
}
window.nativeLibraryLoaded=nativeLibraryLoaded;

// Keep file picker compatibility for tracks imported from the browser.
async function readID3(file) {
  const meta={};try{
    const buf=await file.slice(0,Math.min(file.size,5*1024*1024)).arrayBuffer(),a=new Uint8Array(buf);
    if(String.fromCharCode(...a.slice(0,3))!=='ID3')return meta;
    const ver=a[3],sizeAt=o=>((a[o]&127)<<21)|((a[o+1]&127)<<14)|((a[o+2]&127)<<7)|(a[o+3]&127);
    const end=Math.min(a.length,10+sizeAt(6));let p=10;
    const decode=(bytes,enc)=>{try{return new TextDecoder(enc===0?'windows-1252':enc===1?'utf-16':enc===2?'utf-16be':'utf-8').decode(bytes).replace(/\0/g,'').replace(/^\uFEFF/,'').trim()}catch{return ''}};
    while(p+10<=end){const id=String.fromCharCode(...a.slice(p,p+4));if(!/^[A-Z0-9]{4}$/.test(id))break;
      const n=ver===4?sizeAt(p+4):((a[p+4]<<24)|(a[p+5]<<16)|(a[p+6]<<8)|a[p+7]);if(!n||p+10+n>end)break;
      const b=a.slice(p+10,p+10+n);
      if(['TIT2','TPE1','TALB'].includes(id))meta[{TIT2:'title',TPE1:'artist',TALB:'album'}[id]]=decode(b.slice(1),b[0]);
      if(id==='APIC'&&b.length>10){let i=1;while(i<b.length&&b[i])i++;const mime=decode(b.slice(1,i),0)||'image/jpeg';i+=2;if(b[0]===0||b[0]===3){while(i<b.length&&b[i])i++;i++}else{while(i+1<b.length&&(b[i]||b[i+1]))i+=2;i+=2}if(i<b.length)meta.cover=URL.createObjectURL(new Blob([b.slice(i)],{type:mime}))}
      p+=10+n;
    }
  }catch(err){console.warn('ID3 read failed',err)}return meta;
}
$('#add').onclick=()=>$('#files').click();
$('#files').onchange=async event=>{
  const files=[...event.target.files].filter(f=>f.type.startsWith('audio/')||/\.(mp3|m4a|wav|flac|ogg)$/i.test(f.name));
  for(const file of files){
    const id='import:'+ (++importedCounter);
    const name=file.name.replace(/\.[^.]+$/,'');
    const parts=name.split(/\s+[-–—]\s+/);
    const artist=parts.length>1?parts.shift():'Моя музыка',title=parts.length?parts.join(' — '):name;
    const url=URL.createObjectURL(file),meta=await readID3(file);
    const t={id,title:meta.title||title,artist:meta.artist||artist,album:meta.album||'Без альбома',
      cover:meta.cover||'',duration:0,url,colors:DEFAULT_COLORS};
    tracks.push(t);lookup.set(id,t);order.push(id);
    const probe=document.createElement('audio');probe.preload='metadata';probe.src=url;
    probe.onloadedmetadata=()=>{t.duration=Number.isFinite(probe.duration)?probe.duration:0;probe.removeAttribute('src');probe.load();};
    probe.onerror=()=>{probe.removeAttribute('src');};
  }
  renderQueue();
  if ($('#libraryPanel').classList.contains('open'))renderNativeLibrary();
  toast('Добавлено файлов: '+files.length);
  event.target.value='';
};
audio.ontimeupdate=()=>{
  if (!track()?.url) return;
  currentPosition=audio.currentTime;
  if (Number.isFinite(audio.duration) && audio.duration>0) track().duration=audio.duration;
  updateTimes();
};
audio.onended=next;

// 0.3: interpolate the Media3 position between 650ms callbacks.
// The translucent blurred lens is cheap: the canvas is low-resolution, under 30fps.
const wave=$('#wave');
function frame(now) {
  requestAnimationFrame(frame);
  if(document.hidden)return;
  const speed=scrub ? 25 : (playing ? 32 : 85);
  if(now-lastWaveTime < speed)return;
  lastWaveTime=now;
  updateTimes(now);
  const rect=wave.getBoundingClientRect();
  if(!rect.width||!rect.height)return;
  const ratio=Math.min(window.devicePixelRatio||1,1.1);
  const w=Math.min(560,Math.round(rect.width*ratio));
  const h=Math.min(90,Math.round(rect.height*ratio));
  if(wave.width!==w||wave.height!==h){wave.width=w;wave.height=h;}
  const c=wave.getContext('2d',{alpha:false});
  if(!c || !track())return;
  const dur=activeDuration();
  const progress=dur>0 ? Math.min(1,visiblePosition(now)/dur) : 0;
  c.fillStyle='#4c463e';c.fillRect(0,0,w,h);
  const filled=w*progress;
  const fill=c.createLinearGradient(0,0,w,0);
  fill.addColorStop(0,'#fff0d5');fill.addColorStop(.65,'#f4dbb7');fill.addColorStop(1,'#d7b890');
  c.fillStyle=fill;
  c.beginPath();c.moveTo(0,0);
  const amplitude=Math.max(2,h*.14);
  for(let y=0;y<=h;y+=Math.max(2,Math.round(h/18))){
    c.lineTo(filled+Math.sin(y*.115+now*.00125)*amplitude,y);
  }
  c.lineTo(filled,h);c.lineTo(0,h);c.closePath();c.fill();
  // Bright moving wave boundary and a lightweight soft edge, no static colored blotch.
  if(filled>1){
    const edge=c.createLinearGradient(filled-11,0,filled+11,0);
    edge.addColorStop(0,'#e7d7ba00');edge.addColorStop(.5,'#fff9eecb');edge.addColorStop(1,'#fff8ee00');
    c.fillStyle=edge;c.fillRect(filled-11,0,22,h);
  }
}

stackMarkup();
updatePlay();
renderQueue();
requestAnimationFrame(frame);
// MainActivity requests permission and scans only after the WebView is ready.
