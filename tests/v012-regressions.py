"""v0.12 regressions: uninterrupted handoff + lightweight horizontal gesture. Browser-only, not Android FPS proof."""
from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
html=(root/'app/src/main/assets/index.html').read_text().replace('<script src="app.js"></script>','')
js=(root/'app/src/main/assets/app.js').read_text()
with sync_playwright() as p:
  browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
  page=browser.new_page(viewport={'width':393,'height':852},is_mobile=True,has_touch=True)
  errors=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  page.set_content(html)
  page.evaluate('''() => {window.AndroidBridge={playQueue(){},selectTrack(){},setPlaying(){},seekTo(){},reorderQueue(){},moveQueueItem(){},requestCoverPalette(){},isLowRamDevice(){return false}}}''')
  page.add_script_tag(content=js)
  page.evaluate('''() => {
    tracks=Array.from({length:32},(_,i)=>({id:'a'+i,title:'Track '+i,artist:'Testing',
    album:i<12?'Red':'Blue',albumId:i<12?'red':'blue',uri:'content://test/'+i,duration:220,
    colors:i<12?['#b9455b','#c67670']:['#597cca','#5478af']}));
    lookup=new Map(tracks.map(t=>[String(t.id),t]));order=tracks.map(t=>t.id);
    current='a0';nativeQueueReady=true;stackMarkup();
    window.originalFront=stackCards.front;
  }''')
  # Intro must preserve the playing cover at depth=0.
  page.evaluate('enterDeckMode();paintDeck(0,false)')
  at_zero=page.evaluate('''() => ({same:deckCards.get(0)===originalFront,
    title:getComputedStyle(document.querySelector('#title')).opacity,
    deckTitle:getComputedStyle(document.querySelector('#deckTitle')).opacity,
    cover:deckCards.get(0).style.opacity,shade:deckCards.get(0).querySelector('.deck-veil').style.opacity})''')
  assert at_zero['same'],at_zero
  assert float(at_zero['title'])>.98 and float(at_zero['deckTitle'])<.02,at_zero
  assert float(at_zero['shade'])<.01,at_zero
  # Near playing: title, brightness and content must move continuously.
  page.evaluate('paintDeck(2.3,true)')
  observed=[]
  for depth in [1.0,.75,.5,.25,.1,0]:
    page.evaluate('(d)=>paintDeck(d,true)',depth)
    observed.append(page.evaluate('''() => ({depth:deckPaintDepth,
      normal:parseFloat(document.querySelector('#title').style.opacity),
      browse:parseFloat(document.querySelector('#deckTitle').style.opacity),
      dim:parseFloat(deckCards.get(0).querySelector('.deck-veil').style.opacity),
      frontSame:deckCards.get(0)===originalFront})'''))
  assert all(t['frontSame'] for t in observed),observed
  assert all(observed[i]['normal']<=observed[i+1]['normal'] for i in range(len(observed)-1)),observed
  assert all(observed[i]['dim']>=observed[i+1]['dim'] for i in range(len(observed)-1)),observed
  assert observed[-1]['normal']==1 and observed[-1]['dim']==0,observed[-1]
  page.evaluate('restorePlayingCover()')
  final=page.evaluate('''() => ({same:stackCards.front===originalFront,
    normal:parseFloat(getComputedStyle(document.querySelector('#title')).opacity),
    deck:deckMode,first:stackCards.front.dataset.id,
    count:document.querySelectorAll('#stack>.album').length})''')
  assert final['same'] and final['first']=='a0' and not final['deck'],final
  assert final['normal']>.95 and final['count']==4,final
  # Adjacent tracks across an album boundary shouldn't clone a 4-card scene.
  page.evaluate("current='a11';stackMarkup();choose('a12',1)")
  assert page.locator('.stack-scene-old').count()==0
  # The moving cards use compositor transforms/opacity, NOT full-image blur/mask.
  css=page.evaluate('''() => {
    let e=document.querySelector('#stack .album.back1');let s=getComputedStyle(e);
    return {filter:s.filter, mask:s.maskImage,webkitMask:s.webkitMaskImage};
  }''')
  assert css['filter']=='none' and css['mask']=='none',css
  assert css['webkitMask']=='none',css
  page.wait_for_timeout(640)
  # Gesture remains functional after a deck return and native playlist selection.
  page.evaluate('current="a15";stackMarkup()')
  r=page.locator('#stack').bounding_box();x=r['x']+r['width']*.5;y=r['y']+r['height']*.5
  page.mouse.move(x,y);page.mouse.down();page.mouse.move(x-140,y,steps=15);page.mouse.up()
  assert page.evaluate('current')=='a16',page.evaluate('current')
  assert not errors,errors
  print('PASS v0.12: DOM identity survives return; title+veil continuous; no adjacent clone; no back-card GPU filters; horizontal gestures work')
  browser.close()
