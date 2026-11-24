"""0.10 browser UI regressions; not a device or Android Media3 test."""
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
      window.bridgeCalls=[];
      window.AndroidBridge={
        playQueue(...x){bridgeCalls.push(['playQueue',...x])},
        selectTrack(...x){bridgeCalls.push(['selectTrack',...x])},
        reorderQueue(...x){bridgeCalls.push(['reorderQueue',...x])},
        moveQueueItem(){},setPlaying(){},seekTo(){},requestCoverPalette(...x){bridgeCalls.push(['palette',...x])}
      };
    }''')
    page.add_script_tag(content=js)
    page.evaluate('''() => {
      tracks=Array.from({length:25},(_,i)=>({id:'t'+i,title:'Song '+i,artist:'Band',
        album:i<12?'Red':'Blue',albumId:i<12?'r':'b',
        uri:'content://audio/'+i,coverUri:'',duration:180,
        colors:i<12?['#ad3a31','#e77261']:['#235bbb','#5d83e3']}));
      lookup=new Map(tracks.map(t=>[t.id,t]));order=tracks.map(t=>t.id);
      current='t0';playing=true;nativeQueueReady=true;stackMarkup();renderQueue();updatePlay();
    }''')
    front=page.locator('#stack .front')
    assert front.evaluate('(e)=>getComputedStyle(e).contain')=='layout style'
    assert front.evaluate('(e)=>getComputedStyle(e).overflowX')=='visible'
    rim=front.locator('.cover-rim')
    assert float(rim.evaluate('(e)=>getComputedStyle(e).opacity'))>.94
    assert '24px' in rim.evaluate('(e)=>getComputedStyle(e).boxShadow')
    before=page.evaluate('''() => ({a:ambientColors,light:document.querySelector('#screen').style.getPropertyValue('--panel-light-a'),
      glow:document.querySelector('#stack').style.getPropertyValue('--aura-a')})''')
    page.evaluate('enterDeckMode();paintDeck(14,false);deckDepth=14;')
    during=page.evaluate('''() => ({a:ambientColors,light:document.querySelector('#screen').style.getPropertyValue('--panel-light-a'),
      glow:document.querySelector('#stack').style.getPropertyValue('--aura-a')})''')
    assert during==before,(during,before)
    page.evaluate("window.nativeCoverPalette('t14','#2255aa','#779add')")
    assert page.evaluate('ambientColors')==before['a']
    # Actual playback changes the shared palette; browsing it must not.
    page.evaluate('choose("t14",1)')
    assert page.evaluate('ambientColors')!=before['a']
    for panel in ('#libraryPanel','#queueSheet'):
        bg=page.locator(panel).evaluate('(n)=>getComputedStyle(n).backgroundImage')
        assert 'radial-gradient' in bg,(panel,bg)
    # Restore to a clean queue with an unshuffled baseline.
    page.evaluate('''() => {
      resetShuffleMode();order=tracks.map(t=>t.id);current='t0';nativeQueueReady=true;
      stackMarkup();renderQueue();
    }''')
    initial=page.evaluate('order.slice()')
    button=page.locator('#shuffleQueue')
    assert button.get_attribute('aria-pressed')=='false'
    off_opacity=float(button.evaluate('(e)=>getComputedStyle(e).opacity'))
    page.locator('#queueOpen').click();page.wait_for_timeout(410)
    button.click();page.wait_for_timeout(60)
    shuffled=page.evaluate('order.slice()')
    assert shuffled!=initial and set(shuffled)==set(initial)
    assert button.get_attribute('aria-pressed')=='true'
    assert button.evaluate('(e)=>e.classList.contains("is-active")')
    on_opacity=float(button.evaluate('(e)=>getComputedStyle(e).opacity'))
    assert on_opacity>off_opacity,(off_opacity,on_opacity)
    assert page.evaluate('window.bridgeCalls.at(-1)[0]')=='reorderQueue'
    button.click();page.wait_for_timeout(70)
    assert page.evaluate('order.slice()')==initial
    assert button.get_attribute('aria-pressed')=='false'
    assert not button.evaluate('(e)=>e.classList.contains("is-active")')
    assert page.evaluate('window.bridgeCalls.at(-1)[0]')=='reorderQueue'
    assert page.locator('#queueSheet #add').count()==0
    assert page.locator('#libraryPanel #add').count()==1
    assert page.locator('.nav-item[data-tab="Настройки"]').count()==1
    assert page.locator('.nav-item[data-tab="Профиль"]').count()==0
    page.screenshot(path=str(root/'v010-queue-preview.png'))
    page.evaluate("setQueueSheet('closed')")
    page.locator('.nav-item[data-tab="Библиотека"]').click()
    page.wait_for_timeout(420)
    page.screenshot(path=str(root/'v010-library-preview.png'))
    assert not errors,errors
    print('PASS v0.10: travelling bright rim, palette locked to playing, shared ambient gradient, reversible shuffle, MP3 import moved, settings')
    browser.close()
