"""Browser regression checks for v0.8 (not Android playback/runtime validation)."""
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
    page.evaluate("""() => {window.AndroidBridge={playQueue(){},selectTrack(){},setPlaying(){},seekTo(){},reorderQueue(){},requestCoverPalette(){}};}""")
    page.add_script_tag(content=js)
    page.evaluate("""() => {
      tracks=Array.from({length:30},(_,i)=>({id:'t'+i,title:'Песня '+i,artist:'Исполнитель',album:i<15?'Красный альбом':'Синий альбом',
        albumId:i<15?'R':'B',uri:'content://media/audio/'+i,coverUri:'',duration:180,
        colors:i<15?['#bf3f4c','#cb7966']:['#2863bf','#6c92db']}));
      lookup=new Map(tracks.map(t=>[t.id,t]));order=tracks.map(t=>t.id);
      current='t0';nativeQueueReady=true;stackMarkup();
    }""")
    def drag(x,y,dx,dy):
        page.mouse.move(x,y);page.mouse.down();page.mouse.move(x+dx,y+dy,steps=18);page.mouse.up()
    stack=page.locator('#stack').bounding_box()
    x=stack['x']+stack['width']*.53;y=stack['y']+stack['height']*.46
    drag(x,y,0,280)
    page.wait_for_timeout(850)
    assert page.evaluate('deckMode'), 'expected browsing mode after downward swipe'
    assert page.evaluate('deckDepth')>0
    assert page.evaluate("getComputedStyle(document.querySelector('#stack .cover-rim')).opacity")=='0'
    # Return to currently playing first cover, in one or more upward flicks.
    for _ in range(5):
        if not page.evaluate('deckMode'):break
        drag(x,y,0,-260)
        page.wait_for_timeout(900)
    assert not page.evaluate('deckMode'), 'at depth 0 it must restore standard playing mode'
    assert page.locator('#stack .front').count()==1
    assert page.evaluate("getComputedStyle(document.querySelector('#stack .front .cover-rim')).opacity")=='0.94'
    before=page.evaluate('current')
    drag(x,y,-170,0)
    assert page.evaluate('current')!=before, 'horizontal swipe should resume without tapping'
    page.wait_for_timeout(580)
    # Library current track stays in library after row playback.
    page.locator('.nav-item[data-tab="Библиотека"]').click()
    page.locator('.lib-tab[data-mode="tracks"]').click()
    first=page.locator('.library-row[data-id="t7"]')
    first.locator('.lib-row-main').click()
    assert page.evaluate('current')=='t7'
    assert page.locator('#libraryPanel').evaluate('(e)=>e.classList.contains("open")')
    assert page.locator('.nav-item[data-tab="Библиотека"]').evaluate('(e)=>e.classList.contains("active")')
    assert first.evaluate('(e)=>e.classList.contains("is-current")')
    page.wait_for_timeout(350)
    assert float(first.locator('.lib-playing-marker').evaluate('(e)=>getComputedStyle(e).opacity'))>.98
    # While staying in library, menu Play Now must not navigate away either.
    page.locator('.library-row[data-id="t9"] .lib-more').click()
    page.locator('#menuPlayNow').click()
    assert page.evaluate('current')=='t9'
    assert page.locator('#libraryPanel').evaluate('(e)=>e.classList.contains("open")')
    assert page.locator('.library-row[data-id="t9"]').evaluate('(e)=>e.classList.contains("is-current")')
    assert not page.locator('.library-row[data-id="t7"]').evaluate('(e)=>e.classList.contains("is-current")')
    # Live search stays intact after selecting results.
    page.locator('#librarySearch').fill('Песня 18')
    page.locator('.library-row[data-id="t18"] .lib-row-main').click()
    assert page.evaluate('current')=='t18'
    assert page.locator('#librarySearch').input_value()=='Песня 18'
    assert page.locator('#libraryPanel').evaluate('(e)=>e.classList.contains("open")')
    # Native palette callback causes stronger colour field transition.
    old=page.evaluate('ambientColors')
    page.evaluate("window.nativeCoverPalette('t18','#1f54d1','#5c8ce4')")
    new=page.evaluate('ambientColors')
    assert old!=new,(old,new)
    assert page.locator('.ambient-layer.visible').count()==1
    assert page.evaluate('vividAlbumColor("#225dbe")').startswith('#')
    # Branded icon assets and unobtrusive in-app stamp.
    assert page.locator('.brand-mark').count()==2
    assert not errors,errors
    page.screenshot(path=str(root/'v08-library-preview.png'))
    print('PASS v0.8: restore depth 0, playing rim, resume swipe, in-library selection, menu, search, ambient palette, brand')
    browser.close()
