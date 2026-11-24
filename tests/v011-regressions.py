"""End-to-end browser checks for v0.11 refinements (not Android device profiling)."""
from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
html=(root/'app/src/main/assets/index.html').read_text().replace('<script src="app.js"></script>','')
js=(root/'app/src/main/assets/app.js').read_text()
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
    page=browser.new_page(viewport={'width':393,'height':852},has_touch=True,is_mobile=True)
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content(html)
    page.evaluate('''() => {
      window.AndroidBridge={playQueue(){},selectTrack(){},setPlaying(){},seekTo(){},
        reorderQueue(){},moveQueueItem(){},requestCoverPalette(){},isLowRamDevice(){return false}};
      window.paintCount=0;
      const old=CanvasRenderingContext2D.prototype.clearRect;
      CanvasRenderingContext2D.prototype.clearRect=function(...args){
        if(this.canvas?.id==='wave')window.paintCount++;
        return old.apply(this,args);
      };
    }''')
    page.add_script_tag(content=js)
    page.evaluate('''() => {
      tracks=Array.from({length:35},(_,i)=>({id:'t'+i,title:'Song '+i,artist:'Band',album:'Album',
        uri:'content://media/audio/'+i,coverUri:'',duration:180,colors:['#ae644a','#bf93a4']}));
      lookup=new Map(tracks.map(t=>[t.id,t]));order=tracks.map(t=>t.id);
      current='t0';nativeQueueReady=true;playing=true;currentPosition=22;lastNativeStamp=0;
      stackMarkup();updatePlay();renderQueue();
    }''')
    page.wait_for_timeout(250)
    # Rendered timeline MUST be transparent beyond played progress.
    rgba=page.evaluate('''() => {const c=document.querySelector('#wave');
      return [...c.getContext('2d').getImageData(c.width-4,Math.floor(c.height/2),1,1).data];}''')
    assert rgba[3]==0, rgba
    assert page.locator('#timeline').evaluate('(e)=>getComputedStyle(e).backgroundColor')=='rgba(0, 0, 0, 0)'
    # Frame pacing: at most ~24 drawing updates per second on our synthetic phone.
    page.evaluate('window.paintCount=0')
    page.wait_for_timeout(1300)
    count=page.evaluate('window.paintCount')
    assert 10<=count<=29, count
    # A horizontal swipe immediately fades the halo and it stays OFF until the
    # newly playing card settles; then fades in gradually.
    rect=page.locator('#stack').bounding_box();x=rect['x']+rect['width']*.55;y=rect['y']+rect['height']*.44
    page.mouse.move(x,y);page.mouse.down();page.mouse.move(x-150,y,steps=13)
    page.wait_for_timeout(210)
    assert page.evaluate("document.querySelector('#stack').classList.contains('glow-muted')")
    draggingOpacity=float(page.locator('#stack .front .cover-rim').evaluate('(e)=>getComputedStyle(e).opacity'))
    assert draggingOpacity<.1,draggingOpacity
    page.mouse.up();page.wait_for_timeout(170)
    assert page.evaluate("document.querySelector('#stack').classList.contains('glow-muted')")
    page.wait_for_timeout(1060)
    assert not page.evaluate("document.querySelector('#stack').classList.contains('glow-muted')")
    restored=float(page.locator('#stack .front .cover-rim').evaluate('(e)=>getComputedStyle(e).opacity'))
    assert restored>.9,restored
    # The translucent library covers the background UNDER the navigation bar.
    page.locator('.nav-item[data-tab="Библиотека"]').click()
    box=page.locator('#libraryPanel').bounding_box()
    screen=page.locator('#screen').bounding_box()
    assert abs((box['y']+box['height'])-(screen['y']+screen['height']))<2,(box,screen)
    assert page.locator('#libraryPanel #add').count()==0
    for tab in page.locator('.lib-tab').all():
        bg=tab.evaluate('(e)=>getComputedStyle(e).backgroundColor')
        assert bg.startswith('rgba('),bg
    page.screenshot(path=str(root/'v011-library-preview.png'))
    # Expanded swipeable areas: captions and current track should work in
    # addition to the uppermost tiny grabber.
    page.locator('.nav-item[data-tab="Плеер"]').click()
    page.locator('#queueOpen').click();page.wait_for_timeout(430)
    sheet=page.locator('#queueSheet')
    c=page.locator('#queueSheet .queue-caption').nth(1).bounding_box()
    sx=c['x']+c['width']*.4;sy=c['y']+c['height']*.5
    y0=sheet.bounding_box()['y']
    page.mouse.move(sx,sy);page.mouse.down();page.mouse.move(sx,sy-130,steps=14)
    y1=sheet.bounding_box()['y']
    assert y1<y0-70,(y0,y1)
    page.mouse.up();page.wait_for_timeout(430)
    assert page.evaluate('sheetStage')=='full'
    # Shuffle button state changes instantly without forcing an SVG rotation.
    button=page.locator('#shuffleQueue')
    assert button.evaluate('(e)=>getComputedStyle(e).transitionDuration')=='0s'
    button.click();page.wait_for_timeout(25)
    assert not button.evaluate('(e)=>e.classList.contains("shuffle-pulse")')
    assert not errors,errors
    print(f'PASS 0.11: halo delayed while swipe, transparent timeline, glass tabs, panel background, swipe zones, no shuffle animation; {count} canvas frames/1.3s')
    browser.close()
