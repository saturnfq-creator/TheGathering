package com.thegathering.player

import android.Manifest
import android.content.ComponentName
import android.content.ContentUris
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import com.google.common.util.concurrent.ListenableFuture
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Executors

/** WebView owns the visuals; the single Media3 service owns all playback state. */
class MainActivity : ComponentActivity() {
    private lateinit var webView: WebView
    private val main = Handler(Looper.getMainLooper())
    private val io = Executors.newSingleThreadExecutor()
    private var controllerFuture: ListenableFuture<MediaController>? = null
    private var controller: MediaController? = null
    private var pageReady = false
    private var foreground = false
    private var destroyed = false
    private val pendingActions = ArrayDeque<(MediaController) -> Unit>()
    private var libraryScanRunning = false

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) scanAndSend() else evaluate("window.nativeLibraryLoaded([])")
    }

    private val progress = object : Runnable {
        override fun run() {
            if (!destroyed && foreground) {
                publishPlayerState()
                main.postDelayed(this, 650L)
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = Color.rgb(35, 28, 24)
        window.navigationBarColor = Color.rgb(20, 18, 17)
        createWebView()
        // Android gesture navigation and the classic Back key share one path.
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (!pageReady || destroyed || !::webView.isInitialized) {
                    moveTaskToBack(true)
                    return
                }
                webView.evaluateJavascript(
                    "(function(){try{return !!(window.appNavigateBack && window.appNavigateBack());}catch(e){return false;}})()"
                ) { consumed ->
                    if (!destroyed && consumed != "true") moveTaskToBack(true)
                }
            }
        })
        connectPlayer()
    }

    private fun createWebView() {
        pageReady = false
        webView = WebView(this).apply {
            setBackgroundColor(Color.rgb(25, 22, 20))
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowContentAccess = true
            settings.mediaPlaybackRequiresUserGesture = true
            webChromeClient = WebChromeClient()
            webViewClient = object : WebViewClient() {
                override fun onPageFinished(view: WebView?, url: String?) {
                    if (destroyed || view !== webView) return
                    pageReady = true
                    requestAudioPermission()
                    publishPlayerState()
                }

                override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                    // A killed WebView renderer should not terminate the music process.
                    if (view === webView && !destroyed) {
                        (view.parent as? ViewGroup)?.removeView(view)
                        view.destroy()
                        createWebView()
                    }
                    return true
                }
            }
            addJavascriptInterface(AndroidBridge(), "AndroidBridge")
            loadUrl("file:///android_asset/index.html")
        }
        setContentView(webView)
    }

    private fun connectPlayer() {
        val token = SessionToken(this, ComponentName(this, PlaybackService::class.java))
        val future = MediaController.Builder(this, token).buildAsync()
        controllerFuture = future
        future.addListener({
            if (destroyed) return@addListener
            try {
                val connected = future.get()
                controller = connected
                connected.addListener(object : Player.Listener {
                    override fun onEvents(player: Player, events: Player.Events) {
                        publishPlayerState()
                    }

                    override fun onPlayerError(error: PlaybackException) {
                        publishError("Не удалось воспроизвести файл: " + (error.message ?: "ошибка декодирования"))
                    }
                })
                while (pendingActions.isNotEmpty()) {
                    pendingActions.removeFirst().invoke(connected)
                }
                publishPlayerState()
            } catch (error: Exception) {
                pendingActions.clear()
                publishError("Не удалось подключить аудиодвижок: " + (error.message ?: "неизвестная ошибка"))
            }
        }, ContextCompat.getMainExecutor(this))
    }

    private fun withPlayer(action: (MediaController) -> Unit) {
        main.post {
            if (destroyed) return@post
            val active = controller
            if (active == null) {
                // Avoid a backlog of stale play/seek commands while connecting.
                if (pendingActions.size >= 8) pendingActions.removeFirst()
                pendingActions.addLast(action)
            } else {
                try { action(active) } catch (error: Exception) {
                    publishError("Команда плеера не выполнена: " + (error.message ?: "ошибка"))
                }
            }
        }
    }

    private fun evaluate(script: String) {
        main.post {
            if (!destroyed && pageReady && ::webView.isInitialized) {
                webView.evaluateJavascript(script, null)
            }
        }
    }

    private fun publishError(message: String) {
        val quoted = JSONObject.quote(message)
        evaluate("window.nativePlaybackError($quoted)")
    }

    private fun publishPlayerState() {
        val player = controller ?: return
        if (!pageReady || destroyed) return
        val currentItem = player.currentMediaItem
        val duration = player.duration.coerceAtLeast(0L)
        val position = player.currentPosition.coerceAtLeast(0L)
        val json = JSONObject().apply {
            put("id", currentItem?.mediaId ?: "")
            put("position", position / 1000.0)
            put("duration", duration / 1000.0)
            put("playing", player.isPlaying)
            put("playWhenReady", player.playWhenReady)
            put("buffering", player.playbackState == Player.STATE_BUFFERING)
            put("ready", player.playbackState == Player.STATE_READY)
        }
        evaluate("window.nativePlaybackState($json)")
    }

    private fun requestAudioPermission() {
        val permission = if (Build.VERSION.SDK_INT >= 33) {
            Manifest.permission.READ_MEDIA_AUDIO
        } else Manifest.permission.READ_EXTERNAL_STORAGE
        if (ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED) {
            scanAndSend()
        } else permissionLauncher.launch(permission)
    }

    private fun scanAndSend() {
        synchronized(this) {
            if (libraryScanRunning || destroyed) return
            libraryScanRunning = true
        }
        io.execute {
            val result = JSONArray()
            try {
                val collection = MediaStore.Audio.Media.EXTERNAL_CONTENT_URI
                val projection = arrayOf(
                    MediaStore.Audio.Media._ID,
                    MediaStore.Audio.Media.TITLE,
                    MediaStore.Audio.Media.ARTIST,
                    MediaStore.Audio.Media.ALBUM,
                    MediaStore.Audio.Media.ALBUM_ID,
                    MediaStore.Audio.Media.DURATION,
                    MediaStore.Audio.Media.TRACK
                )
                val where = "${MediaStore.Audio.Media.IS_MUSIC} != 0"
                val sort = "${MediaStore.Audio.Media.ARTIST} COLLATE NOCASE ASC, ${MediaStore.Audio.Media.ALBUM} COLLATE NOCASE ASC, ${MediaStore.Audio.Media.TRACK} ASC"
                contentResolver.query(collection, projection, where, null, sort)?.use { cursor ->
                    val idCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media._ID)
                    val titleCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.TITLE)
                    val artistCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ARTIST)
                    val albumCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM)
                    val albumIdCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM_ID)
                    val durationCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DURATION)
                    val trackCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.TRACK)
                    while (cursor.moveToNext()) {
                        val id = cursor.getLong(idCol)
                        val albumId = cursor.getLong(albumIdCol)
                        val uri = ContentUris.withAppendedId(collection, id)
                        val art = ContentUris.withAppendedId(
                            android.net.Uri.parse("content://media/external/audio/albumart"), albumId
                        )
                        result.put(JSONObject().apply {
                            put("id", id.toString())
                            put("title", cursor.getString(titleCol) ?: "Без названия")
                            put("artist", cursor.getString(artistCol) ?: "Неизвестный исполнитель")
                            put("album", cursor.getString(albumCol) ?: "Без альбома")
                            put("albumId", albumId.toString())
                            put("trackNumber", cursor.getInt(trackCol))
                            put("duration", cursor.getLong(durationCol) / 1000.0)
                            put("uri", uri.toString())
                            put("coverUri", art.toString())
                        })
                    }
                }
            } catch (error: Exception) {
                android.util.Log.e("TheGathering", "Library scan failed", error)
            } finally {
                synchronized(this) { libraryScanRunning = false }
                evaluate("window.nativeLibraryLoaded($result)")
            }
        }
    }

    inner class AndroidBridge {
        @JavascriptInterface fun scanLibrary() { scanAndSend() }

        @JavascriptInterface fun playQueue(playlistJson: String, selectedId: String) {
            withPlayer { player ->
                val entries = JSONArray(playlistJson)
                val items = ArrayList<MediaItem>(entries.length())
                var selectedIndex = 0
                for (i in 0 until entries.length().coerceAtMost(10_000)) {
                    val t = entries.getJSONObject(i)
                    val uri = t.optString("uri")
                    if (!uri.startsWith("content://")) continue
                    val id = t.optString("id")
                    if (id == selectedId) selectedIndex = items.size
                    items.add(MediaItem.Builder()
                        .setMediaId(id)
                        .setUri(uri)
                        .setMediaMetadata(MediaMetadata.Builder()
                            .setTitle(t.optString("title", "Без названия"))
                            .setArtist(t.optString("artist", ""))
                            .setAlbumTitle(t.optString("album", ""))
                            .build())
                        .build())
                }
                if (items.isEmpty()) {
                    publishError("Не удалось найти музыку для воспроизведения")
                } else {
                    player.setMediaItems(items, selectedIndex, 0L)
                    player.repeatMode = Player.REPEAT_MODE_ALL
                    player.prepare()
                    player.play()
                    publishPlayerState()
                }
            }
        }

        @JavascriptInterface fun selectTrack(id: String) {
            withPlayer { player ->
                val index = (0 until player.mediaItemCount).firstOrNull {
                    player.getMediaItemAt(it).mediaId == id
                }
                if (index != null) {
                    player.seekTo(index, 0L)
                    player.play()
                } else {
                    publishError("Композиция отсутствует в очереди")
                }
            }
        }

        @JavascriptInterface fun setPlaying(playing: Boolean) {
            withPlayer { player ->
                if (playing && player.mediaItemCount == 0) {
                    publishError("Сначала выбери песню из библиотеки")
                } else if (playing) player.play() else player.pause()
            }
        }

        @JavascriptInterface fun seekTo(seconds: Double) {
            withPlayer { player ->
                if (player.mediaItemCount > 0 && seconds.isFinite()) {
                    player.seekTo((seconds.coerceAtLeast(0.0) * 1000).toLong())
                    publishPlayerState()
                }
            }
        }

        @JavascriptInterface fun reorderQueue(idsJson: String) {
            withPlayer { player ->
                if (!player.isCommandAvailable(Player.COMMAND_CHANGE_MEDIA_ITEMS)) return@withPlayer
                val ids = JSONArray(idsJson)
                if (ids.length() != player.mediaItemCount) return@withPlayer
                val desired = (0 until ids.length()).map { ids.getString(it) }
                val actual = (0 until player.mediaItemCount)
                    .map { player.getMediaItemAt(it).mediaId }.toMutableList()
                if (desired.toSet() != actual.toSet() || desired.size != desired.toSet().size) return@withPlayer
                // moveMediaItem preserves the current playing media item and position.
                for (i in desired.indices) {
                    if (actual[i] == desired[i]) continue
                    val oldIndex = actual.indexOf(desired[i])
                    if (oldIndex < 0) return@withPlayer
                    player.moveMediaItem(oldIndex, i)
                    actual.removeAt(oldIndex)
                    actual.add(i, desired[i])
                }
                publishPlayerState()
            }
        }
    }

    override fun onResume() {
        super.onResume()
        foreground = true
        main.removeCallbacks(progress)
        main.post(progress)
    }

    override fun onPause() {
        foreground = false
        main.removeCallbacks(progress)
        super.onPause()
    }

    override fun onDestroy() {
        destroyed = true
        foreground = false
        main.removeCallbacksAndMessages(null)
        io.shutdownNow()
        controllerFuture?.let { MediaController.releaseFuture(it) }
        if (::webView.isInitialized) {
            (webView.parent as? ViewGroup)?.removeView(webView)
            webView.destroy()
        }
        super.onDestroy()
    }
}
