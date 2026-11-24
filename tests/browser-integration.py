"""Optional local browser sanity test; not a substitute for Android device testing.
Run: python tests/browser-integration.py
"""
from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
html=(root/'app/src/main/assets/index.html').read_text().replace('<script src="app.js"></script>','')
js=(root/'app/src/main/assets/app.js').read_text()
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
    page=browser.new_page(viewport={'width':393,'height':852},device_scale_factor=1,has_touch=True,is_mobile=True)
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content(html)
    page.evaluate("""() => {
      window.moves=[]; window.AndroidBridge={
        playQueue(){},selectTrack(){},setPlaying(){},seekTo(){},
        reorderQueue(){},moveQueueItem:(id,before)=>window.moves.push([id,before]),
        requestCoverPalette(){}
      };
    }""")
    page.add_script_tag(content=js)
    page.evaluate("""() => {
       tracks=Array.from({length:35},(_,i)=>({id:'t'+i,title:'Песня '+i,artist:'Тест',album:i<12?'Red':'Blue',
         albumId:i<12?'red':'blue',uri:'content://media/audio/'+i,coverUri:'',duration:180,
         colors:i<12?['#b64149','#d97b70']:['#3f68bf','#7089d8']}));
       lookup=new Map(tracks.map(t=>[t.id,t]));order=tracks.map(t=>t.id);
       current='t0';nativeQueueReady=true;stackMarkup();
    }""")
    page.wait_for_timeout(90)
    stack=page.locator('#stack').bounding_box()
    x=stack['x']+stack['width']*.53;y=stack['y']+stack['height']*.48
    def drag(startx,starty,dx,dy,steps=14):
        page.mouse.move(startx,starty);page.mouse.down()
        page.mouse.move(startx+dx,starty+dy,steps=steps)
        page.mouse.up()
    drag(x,y,0,345)
    page.wait_for_timeout(900)
    depth=page.evaluate('deckDepth');print('down depth',depth)
    assert depth>=2 and depth<=4,depth
    drag(x,y,0,295)
    page.wait_for_timeout(900)
    depth2=page.evaluate('deckDepth');print('down again depth',depth2)
    assert depth2>depth
    drag(x,y,0,-275)
    page.wait_for_timeout(900)
    depth3=page.evaluate('deckDepth');print('up depth',depth3)
    assert depth3<depth2-1, (depth3,depth2)
    page.screenshot(path=str(root/'player-deck-preview.png'))
    # browse mode must ignore ordinary horizontal switches
    before=page.evaluate('current')
    drag(x,y,190,0)
    page.wait_for_timeout(250)
    assert page.evaluate('current')==before
    # Choose a blue card from depth 13 to verify a cross-album fade before rebuilding.
    page.evaluate('deckDepth=13;paintDeck(13,false)')
    page.locator('.deck-card[data-offset="13"]').click()
    assert page.evaluate('current')=='t13'
    assert page.locator('.stack-scene-old').count()==1
    page.wait_for_timeout(560)
    assert page.locator('.stack-scene-old').count()==0
    # Back swipe from blue to red should still be directional, with crossfade.
    # Select previous across the album boundary, by pressing a real swipe.
    page.evaluate('current="t12";history=[];stackMarkup()')
    drag(x,y,175,0)
    page.wait_for_timeout(45)
    assert page.evaluate('current')=='t11'
    assert page.locator('.stack-scene-old').count()==0  # adjacent slide uses existing cards
    page.wait_for_timeout(650)
    # Queue sheet follows the finger before release.
    page.locator('#queueOpen').click()
    page.wait_for_timeout(400)
    sheet=page.locator('#queueSheet')
    top0=sheet.bounding_box()['y']
    grab=page.locator('#queueGrab').bounding_box()
    gx=grab['x']+grab['width']/2;gy=grab['y']+grab['height']/2
    page.mouse.move(gx,gy);page.mouse.down();page.mouse.move(gx,gy-150,steps=12)
    top_mid=sheet.bounding_box()['y']
    print('sheet tops',top0,top_mid)
    assert top_mid<top0-70,(top0,top_mid)
    page.mouse.up();page.wait_for_timeout(550)
    assert page.evaluate('sheetStage')=='full'
    # Move a row; on release its real row must be visible immediately and native
    # receives a single item move instead of full reorderQueue.
    handle=page.locator('#queueList .handle').nth(2).bounding_box()
    hx=handle['x']+handle['width']/2;hy=handle['y']+handle['height']/2
    page.mouse.move(hx,hy);page.mouse.down();page.mouse.move(hx,hy-155,steps=12);page.mouse.up()
    assert page.locator('.queue-drag-ghost').count()==0
    assert page.locator('.queue-item.drag-settling').count()==0
    page.wait_for_timeout(110)
    print('queue native moves',page.evaluate('window.moves'))
    assert page.evaluate('window.moves.length')>=1
    # Current album-coloured glow is a gradient with no GPU blur.
    css=page.evaluate("""() => ({blur:getComputedStyle(document.querySelector('#stack'),'::before').filter,
        bg:getComputedStyle(document.querySelector('#stack'),'::before').backgroundImage})""")
    assert css['blur']=='none' and 'radial-gradient' in css['bg']
    assert not errors,errors
    print('PASS browser integration: kinetic depth, up return, album fade, live sheet, instant queue drop, palette glow')
    browser.close()
