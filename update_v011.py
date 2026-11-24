from pathlib import Path
root=Path('/mnt/data/TheGathering_v0_11')
htmlp=root/'app/src/main/assets/index.html'
jsp=root/'app/src/main/assets/app.js'
kotlinp=root/'app/src/main/java/com/thegathering/player/MainActivity.kt'
html=htmlp.read_text()
js=jsp.read_text()

def js_replace(a,b):
 global js
 assert a in js, f'Missing JS pattern: {a[:115]}'
 js=js.replace(a,b)

def html_replace(a,b):
 global html
 assert a in html, f'Missing HTML pattern: {a[:115]}'
 html=html.replace(a,b)

html_replace('''<div class="library-head"><h2 id="panelHeading">Библиотека</h2><div class="library-head-actions"><button class="library-import" id="add" type="button" aria-label="Добавить MP3 из файлов" title="Импортировать MP3">＋</button><img class="brand-mark" src="brand_monochrome.png" alt=""/></div></div>''', '''<div class="library-head"><h2 id="panelHeading">Библиотека</h2><div class="library-head-actions"><img class="brand-mark" src="brand_monochrome.png" alt=""/></div></div>''')
# Keep hidden input/ID3 import path for later internal use without any visible import control.
html_replace('''</style></head><body><main class="screen" id="screen">''','''
/* The Gathering v0.11: fewer repainting effects, unified translucent library. */
/* Fixed background fills the whole app behind the glass bottom navigation;
   content still has sufficient scroll padding to clear the navigation bar. */
.library-panel{
  top:0!important;bottom:0!important;left:0!important;right:0!important;
  padding-bottom:calc(max(58px,12cqw) + max(1.2%,env(safe-area-inset-bottom)) + 28px)!important;
}
.library-tabs{background:transparent!important;}
.lib-tab{
  background:#ffffff11!important;
  border:1px solid #ffffff32!important;
  color:#d0c4b8!important;
  box-shadow:inset 0 1px 0 #ffffff0c;
}
.lib-tab.active{
  background:#ffffff23!important;
  border-color:#f4dcbb80!important;
  color:#f6e2c9!important;
  box-shadow:inset 0 1px 0 #fff6e522,0 0 10px #d6b28d16;
}
/* The empty section of the glass timeline shows the background beneath it.
   The canvas draws ONLY the played progress. */
.timeline{background:transparent!important;}
/* Keep the approved, bright travelling rim but suspend its expensive shadows
   during swipes; restore it only after the card settles. */
.stack.glow-muted .album>.cover-rim{
  opacity:0!important;
  transition:opacity 150ms ease-out!important;
}
.stack:not(.glow-muted) .album>.cover-rim{
  transition:opacity 600ms cubic-bezier(.2,.8,.2,1)!important;
}
/* Avoid permanent full-card gradient scaling that forces compositing work even
   while the user is not interacting. The ambient palette still tracks playback. */
html.is-playing:not(.lite-motion) .stack::before{animation:none!important;}
.stack::before{transform:none!important;}
/* Shuffle should communicate its state through contrast, not button animation. */
.queue-shuffle-button{transition:none!important;}
.queue-shuffle-button.shuffle-pulse svg{animation:none!important;}
/* A more forgiving gesture zone: captions, current track and header are handles,
   but the actual queue remains scrollable and reorder handles are unchanged. */
.sheet-header,.sheet-grab-area,.queue-now,.queue-caption{touch-action:none;}
@media (max-width:520px){
  .bottom-nav{backdrop-filter:blur(9px) saturate(1.1);-webkit-backdrop-filter:blur(9px) saturate(1.1);}
}
</style></head><body><main class="screen" id="screen">''')

js_replace('// The Gathering 0.10: v0.8-strength travelling rim, fixed playing-track palette, toggle shuffle.',
           '// The Gathering 0.11: deferred travelling glow, low-overdraw timeline, glass library, responsive queue gestures.')
js_replace('''  !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;''',
'''  !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ||
  !!(native && typeof native.isLowRamDevice==='function' && native.isLowRamDevice());''')
js_replace('let titleMeasureFrame = 0;', '''let titleMeasureFrame = 0;
let glowWakeTimer = 0;
// The glow casts several shadows. The expensive shadow stays invisible while a
// card is changing position and returns only after the compositor transition.
function muteCoverGlow(){
  clearTimeout(glowWakeTimer);
  glowWakeTimer=0;
  $('#stack').classList.add('glow-muted');
}
function wakeCoverGlow(delay=250){
  clearTimeout(glowWakeTimer);
  glowWakeTimer=setTimeout(()=>{
    glowWakeTimer=0;
    if(!stackAnimating && !swipe && !deckMode){
      $('#stack').classList.remove('glow-muted');
    }
  },delay);
}''')
# no forced perf-ridden inline opacity updates per gesture
js_replace('''  // Fade the travelling highlight in the same coordinate system as the art.
  const rim=front.querySelector('.cover-rim');
  if(rim)rim.style.opacity=String(Math.max(0,1-progress));
''','''  // The glow fades once through a CSS class when the gesture begins. Avoid
  // repainting a multi-shadow rim on EVERY pointer frame.
''')
js_replace('''  panels.forEach(card=>{
    card.classList.remove('gesture');
    card.style.transform='';
    card.style.opacity='';
    card.querySelector('.cover-rim')?.style.removeProperty('opacity');
  });
}''','''  panels.forEach(card=>{
    card.classList.remove('gesture');
    card.style.transform='';
    card.style.opacity='';
    card.querySelector('.cover-rim')?.style.removeProperty('opacity');
  });
  // An aborted swipe springs back for ~520ms before the light reappears.
  wakeCoverGlow(740);
}''')
js_replace("else if(Math.abs(g.dx)>Math.abs(g.dy)*1.17)g.axis='horizontal';",
           "else if(Math.abs(g.dx)>Math.abs(g.dy)*1.17){g.axis='horizontal';if(!deckMode)muteCoverGlow();}")
# Prevent rim re-enabling at pointerup before card transition finishes
js_replace("  stack.classList.remove('gesture-active');\n  if(g.axis==='vertical'){", "  stack.classList.remove('gesture-active');\n  if(g.axis==='vertical'){")
js_replace('''    stackAnimating=false;
    if(stackNeedsRebuild || stackCards.front.dataset.id!==String(current))stackMarkup();''',
'''    stackAnimating=false;
    if(stackNeedsRebuild || stackCards.front.dataset.id!==String(current))stackMarkup();
    // Light emerges once the NEW cover has completed the slide, not during it.
    wakeCoverGlow(250);''')
# In cases where a horizontal gesture is accepted but the stack update routes
# to a rebuild, set a delayed recovery in the generic stackMarkup path.
js_replace('''  stackCards=cards;
  paintCoverAura(current);
  updatePlayerChrome();
}''',
'''  stackCards=cards;
  paintCoverAura(current);
  updatePlayerChrome();
  if($('#stack').classList.contains('glow-muted') && !stackAnimating)wakeCoverGlow(390);
}''')
# for new play via external library, if old animation in progress, keep the already
# queued glow reactivation managed by updateStack.
# Disable shuffle press pulse and its forced reflow.
js_replace('''  const btn=$('#shuffleQueue');
  btn?.classList.remove('shuffle-pulse');
  if(btn){void btn.offsetWidth;btn.classList.add('shuffle-pulse');}
  return true;''', '''  return true;''')
# widen sheet swipe zones, leaving queue row handles intact
js_replace('''[queueGrab,queueSheet.querySelector('.sheet-header'),$('#queueNow')]
  .filter(Boolean).forEach(el=>el.addEventListener('pointerdown',startSheetSwipe));''',
'''[queueGrab,queueSheet.querySelector('.sheet-header'),$('#queueNow'),
  ...queueSheet.querySelectorAll('.queue-caption'),queueSheet.querySelector('.foot')]
  .filter(Boolean).forEach(el=>el.addEventListener('pointerdown',startSheetSwipe));''')
# adjust touch-to-sheet gesture on queue list: when at start and sheet is partial,
# an upward swipe can expand the sheet too; on expanded, upwards scroll normally.
js_replace('''  if(!l.active && y-l.y>12 && queueList.scrollTop<=1 && !sheetSwipe){''',
'''  const delta=y-l.y;
  const canMoveSheet=delta>12 || (delta< -16 && sheetStage==='partial');
  if(!l.active && canMoveSheet && queueList.scrollTop<=1 && !sheetSwipe){''')
js_replace("$('#add').onclick=()=>$('#files').click();", "// MP3 files are discovered by Android MediaStore. No extra library '+' button.")
# canvas alpha=true + transparent unused portion, eliminate shadowBlur per frame.
js_replace("const waveContext=wave.getContext('2d',{alpha:false});", "const waveContext=wave.getContext('2d',{alpha:true});")
js_replace("  c.fillStyle='#4c463e';c.fillRect(0,0,w,h);", "  c.clearRect(0,0,w,h); // Leave unplayed area physically transparent.")
js_replace("    c.shadowColor='#ffe0baaa';c.shadowBlur=lowPowerDevice?0:7;c.stroke();c.restore();", "    // CSS gives the timeline its static halo; a per-frame canvas shadow\n    // would force extra blur rasterization on every progress update.\n    c.stroke();c.restore();")
# Main wave loop: do not spin requestAnimationFrame at 60Hz just to skip 2 of 3 ticks;
# lower frame production while paused, covered by another section or hidden.
js_replace('''function frame(now) {
  // Don't wake WebView 60 times a second while playback is paused or backgrounded.
  if(document.hidden){setTimeout(()=>requestAnimationFrame(frame),700);return;}
  if(!playing && !scrub)setTimeout(()=>requestAnimationFrame(frame),90);
  else requestAnimationFrame(frame);
  // ~24fps while playing, ~16fps on low-end devices, under 4fps on pause.
  const speed=scrub ? 20 : (playing ? (lowPowerDevice?62:42) : 310);
  if(now-lastWaveTime < speed)return;
''',
'''function frame(now) {
  const obscured=$('#libraryPanel').classList.contains('open') ||
      $('#overlay').classList.contains('open') || $('#trackMenu').classList.contains('open');
  // Schedule actual frames at the desired frequency instead of waking WebView
  // 60 times/second and immediately discarding most frames.
  const delay=document.hidden ? 1000 : obscured ? 500 :
      scrub ? 26 : playing ? (lowPowerDevice ? 80 : 48) : 330;
  setTimeout(()=>requestAnimationFrame(frame),delay);
  if(document.hidden || obscured)return;
  const speed=delay-1;
  if(now-lastWaveTime < speed)return;
''')
# avoid extra layout/computed style reads; the width of the canvas only changes
# on resizes. A small check only when needed; read client width/height (lighter).
js_replace('''  const rect=wave.getBoundingClientRect();
  if(!rect.width||!rect.height)return;
  const ratio=Math.min(window.devicePixelRatio||1,1.1);
  const w=Math.min(560,Math.round(rect.width*ratio));
  const h=Math.min(90,Math.round(rect.height*ratio));''',
'''  const width=wave.clientWidth,height=wave.clientHeight;
  if(!width||!height)return;
  const ratio=Math.min(window.devicePixelRatio||1,1.1);
  const w=Math.min(560,Math.round(width*ratio));
  const h=Math.min(90,Math.round(height*ratio));''')

htmlp.write_text(html)
jsp.write_text(js)

# Expose Android's real low-RAM classification instead of relying only on
# sometimes-unavailable hardwareConcurrency/deviceMemory in WebView.
kotlin=kotlinp.read_text()
needle='''    inner class AndroidBridge {
        @JavascriptInterface fun scanLibrary() { scanAndSend() }
'''
assert needle in kotlin
kotlin=kotlin.replace(needle, '''    inner class AndroidBridge {
        @JavascriptInterface fun isLowRamDevice(): Boolean =
            (getSystemService(ACTIVITY_SERVICE) as? android.app.ActivityManager)?.isLowRamDevice ?: false

        @JavascriptInterface fun scanLibrary() { scanAndSend() }
''')
# correct service constant to Context.ACTIVITY_SERVICE
kotlin=kotlin.replace('getSystemService(ACTIVITY_SERVICE)', 'getSystemService(android.content.Context.ACTIVITY_SERVICE)')
kotlinp.write_text(kotlin)

build=root/'app/build.gradle.kts'
app=build.read_text().replace('versionCode = 10','versionCode = 11').replace('versionName = "0.10.0-beta1"','versionName = "0.11.0-beta1"')
build.write_text(app)
workflow=root/'.github/workflows/build-apk.yml'
workflow.write_text(workflow.read_text().replace('TheGathering-v0.10-beta1-APK','TheGathering-v0.11-beta1-APK'))

print('Patched HTML',len(html),'JS',len(js),'Kotlin',len(kotlin))
