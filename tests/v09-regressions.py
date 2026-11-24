"""Browser checks for 0.9 UI, not a substitute for Android WebView or Media3 tests."""
from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
html=(root/'app/src/main/assets/index.html').read_text().replace('<script src="app.js"></script>','')
js=(root/'app/src/main/assets/app.js').read_text()
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
    page=browser.new_page(viewport={'width':393,'height':852},device_scale_factor=1,has_touch=True,is_mobile=True)
    errors=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    page.set_content(html)
    page.evaluate('''() => {
      window.calls=[];
      window.AndroidBridge={
        playQueue(...args){window.calls.push(['playQueue',...args])},
        selectTrack(...args){window.calls.push(['selectTrack',...args])},
        reorderQueue(...args){window.calls.push(['reorderQueue',...args])},
        moveQueueItem(...args){window.calls.push(['moveQueueItem',...args])},
        setPlaying(){},seekTo(){},requestCoverPalette(){}
      };
    }''')
    page.add_script_tag(content=js)
    page.evaluate('''() => {
      tracks=Array.from({length:21},(_,i)=>({id:'t'+i,title:'Song '+i,artist:'Band',album:'Album',
        albumId:'A',uri:'content://media/audio/'+i,coverUri:'',duration:190,
        colors:['#ac6a4a','#804a77']}));
      lookup=new Map(tracks.map(t=>[t.id,t]));
      order=tracks.map(t=>t.id);
      current='t0';nativeQueueReady=true;playing=true;stackMarkup();updatePlay();
    }''')
    page.wait_for_timeout(100)
    assert page.locator('#shuffle').count()==0
    assert page.locator('#shuffleQueue').count()==1
    assert page.locator('#stack .front .cover-rim').count()==1
    assert page.evaluate("getComputedStyle(document.querySelector('#stack'),'::after').display")=='none'
    assert float(page.locator('#stack .front .cover-rim').evaluate('(n)=>getComputedStyle(n).opacity'))>.9
    # The highlight is a card child, so transform must move it with its artwork.
    box=page.locator('#stack').bounding_box()
    x=box['x']+box['width']*.52;y=box['y']+box['height']*.46
    page.mouse.move(x,y);page.mouse.down()
    page.mouse.move(x-75,y,steps=12)
    page.wait_for_timeout(110)
    front=page.locator('#stack .front').bounding_box()
    rim=page.locator('#stack .front .cover-rim').bounding_box()
    assert abs(front['x']-rim['x'])<2 and abs(front['y']-rim['y'])<2,(front,rim)
    opacity=float(page.locator('#stack .front .cover-rim').evaluate('(n)=>getComputedStyle(n).opacity'))
    assert opacity<.1,opacity # v0.11: rim intentionally muted while dragging
    page.mouse.up()
    page.wait_for_timeout(1600)
    assert page.evaluate('current')=='t1'
    assert float(page.locator('#stack .front .cover-rim').evaluate('(n)=>getComputedStyle(n).opacity'))>.9
    page.screenshot(path=str(root/'v09-rim-preview.png'))
    # Physical queue shuffle must preserve current, reorder every upcoming ID,
    # sync the complete new order to native, and not seek/play/restart.
    page.locator('#queueOpen').click();page.wait_for_timeout(420)
    before=page.evaluate('order.slice()')
    page.locator('#shuffleQueue').click()
    after=page.evaluate('order.slice()')
    assert before!=after and after[0]=='t1'
    assert set(before)==set(after)
    assert page.evaluate('playing') is True
    calls=page.evaluate('window.calls')
    assert calls[-1][0]=='reorderQueue',calls
    assert __import__('json').loads(calls[-1][1])==after
    assert page.locator('#queueList .queue-item').first.get_attribute('data-id')==after[1]
    assert len(page.locator('#queueList .queue-item').all())==20
    # In 0.10+, the second click toggles shuffle OFF and restores the order.
    page.locator('#shuffleQueue').click()
    second=page.evaluate('order.slice()')
    assert second==before[1:]+before[:1], (before,second) # current must stay first
    # The sheet should move as one layer, with a constant height and NO reflow.
    sheet=page.locator('#queueSheet')
    rect0=sheet.bounding_box()
    grab=page.locator('#queueGrab').bounding_box()
    gx=grab['x']+grab['width']*.5;gy=grab['y']+grab['height']*.5
    page.mouse.move(gx,gy);page.mouse.down()
    page.mouse.move(gx,gy-120,steps=12)
    rect1=sheet.bounding_box()
    assert abs(rect0['height']-rect1['height'])<1,(rect0,rect1)
    assert rect1['y']<rect0['y']-60,(rect0,rect1)
    page.screenshot(path=str(root/'v09-queue-preview.png'))
    page.mouse.up();page.wait_for_timeout(520)
    assert page.evaluate('sheetStage')=='full'
    page.evaluate("setQueueSheet('closed')")
    page.wait_for_timeout(420)
    expected=page.evaluate('order[1]')
    page.evaluate('next()')
    assert page.evaluate('current')==expected
    assert page.evaluate('window.calls[window.calls.length-1][0]')=='selectTrack'
    assert 'const amplitude=Math.max(.65,Math.min(2,h*.035));' in js
    assert 'Math.sin(y*.085+now*.0006)*amplitude' in js
    assert not errors,errors
    print('PASS v0.9: travelling halo, real native shuffle, coherent next, transform-only sheet, subtle waveform')
    browser.close()
