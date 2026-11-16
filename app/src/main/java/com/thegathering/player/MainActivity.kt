package com.thegathering.player

import android.Manifest
import android.content.ContentUris
import android.content.Intent
import android.content.pm.PackageManager
import android.database.Cursor
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.MediaStore
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject

class MainActivity : ComponentActivity() {
    private lateinit var webView: WebView
    private val permissionLauncher = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) scanAndSend() else webView.evaluateJavascript("window.nativeLibraryLoaded([])", null)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = android.graphics.Color.rgb(35, 28, 24)
        window.navigationBarColor = android.graphics.Color.rgb(20, 18, 17)
        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowContentAccess = true
            settings.mediaPlaybackRequiresUserGesture = true
            webChromeClient = WebChromeClient()
            webViewClient = object : WebViewClient() {
                override fun onPageFinished(view: WebView?, url: String?) {
                    requestAudioPermission()
                }
            }
            addJavascriptInterface(AndroidBridge(), "AndroidBridge")
            loadUrl("file:///android_asset/index.html")
        }
        setContentView(webView)
    }

    private fun requestAudioPermission() {
        val permission = if (Build.VERSION.SDK_INT >= 33) Manifest.permission.READ_MEDIA_AUDIO
            else Manifest.permission.READ_EXTERNAL_STORAGE
        if (ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED) scanAndSend()
        else permissionLauncher.launch(permission)
    }

    private fun scanAndSend() {
        val result = JSONArray()
        val collection = MediaStore.Audio.Media.EXTERNAL_CONTENT_URI
        val projection = arrayOf(
            MediaStore.Audio.Media._ID, MediaStore.Audio.Media.TITLE,
            MediaStore.Audio.Media.ARTIST, MediaStore.Audio.Media.ALBUM,
            MediaStore.Audio.Media.DURATION, MediaStore.Audio.Media.ALBUM_ID
        )
        val selection = "${MediaStore.Audio.Media.IS_MUSIC} != 0"
        val sort = "${MediaStore.Audio.Media.ARTIST} COLLATE NOCASE ASC, ${MediaStore.Audio.Media.TITLE} COLLATE NOCASE ASC"
        try {
            contentResolver.query(collection, projection, selection, null, sort)?.use { cursor ->
                val idCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media._ID)
                val titleCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.TITLE)
                val artistCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ARTIST)
                val albumCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM)
                val durationCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DURATION)
                val albumIdCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM_ID)
                while (cursor.moveToNext()) {
                    val id = cursor.getLong(idCol)
                    val albumId = cursor.getLong(albumIdCol)
                    val uri = ContentUris.withAppendedId(collection, id)
                    val albumArt = ContentUris.withAppendedId(
                        Uri.parse("content://media/external/audio/albumart"), albumId
                    )
                    result.put(JSONObject().apply {
                        put("id", id)
                        put("title", cursor.getString(titleCol) ?: "Без названия")
                        put("artist", cursor.getString(artistCol) ?: "Неизвестный исполнитель")
                        put("album", cursor.getString(albumCol) ?: "")
                        put("duration", cursor.getLong(durationCol) / 1000)
                        put("uri", uri.toString())
                        put("coverUri", albumArt.toString())
                    })
                }
            }
        } catch (_: SecurityException) { }
        val json = result.toString()
        runOnUiThread { webView.evaluateJavascript("window.nativeLibraryLoaded($json)", null) }
    }

    inner class AndroidBridge {
        @JavascriptInterface fun scanLibrary() { scanAndSend() }
        @JavascriptInterface fun playTrack(uri: String, title: String, artist: String) {
            val intent = Intent(this@MainActivity, PlaybackService::class.java).apply {
                action = PlaybackService.ACTION_PLAY
                putExtra(PlaybackService.EXTRA_URI, uri)
                putExtra(PlaybackService.EXTRA_TITLE, title)
                putExtra(PlaybackService.EXTRA_ARTIST, artist)
            }
            ContextCompat.startForegroundService(this@MainActivity, intent)
        }
        @JavascriptInterface fun setPlaying(playing: Boolean) {
            val intent = Intent(this@MainActivity, PlaybackService::class.java).apply {
                action = if (playing) PlaybackService.ACTION_RESUME else PlaybackService.ACTION_PAUSE
            }
            startService(intent)
        }
    }

    override fun onDestroy() {
        if (::webView.isInitialized) webView.destroy()
        super.onDestroy()
    }
}
