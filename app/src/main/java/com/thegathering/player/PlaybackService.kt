package com.thegathering.player

import android.content.Intent
import android.net.Uri
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService

class PlaybackService : MediaSessionService() {
    private var mediaSession: MediaSession? = null
    private var exoPlayer: ExoPlayer? = null

    override fun onCreate() {
        super.onCreate()
        exoPlayer = ExoPlayer.Builder(this).build()
        mediaSession = MediaSession.Builder(this, exoPlayer!!).build()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        super.onStartCommand(intent, flags, startId)
        if (intent?.action == ACTION_PLAY) {
            val uri = intent.getStringExtra(EXTRA_URI)
            val title = intent.getStringExtra(EXTRA_TITLE) ?: "Unknown track"
            val artist = intent.getStringExtra(EXTRA_ARTIST) ?: "Unknown artist"
            if (uri != null) {
                val item = MediaItem.Builder()
                    .setUri(Uri.parse(uri))
                    .setMediaMetadata(MediaMetadata.Builder().setTitle(title).setArtist(artist).build())
                    .build()
                exoPlayer?.setMediaItem(item)
                exoPlayer?.prepare()
                exoPlayer?.play()
            }
        } else if (intent?.action == ACTION_PAUSE) {
            exoPlayer?.pause()
        } else if (intent?.action == ACTION_RESUME) {
            exoPlayer?.play()
        }
        return START_NOT_STICKY
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = mediaSession

    override fun onDestroy() {
        mediaSession?.release()
        exoPlayer?.release()
        mediaSession = null
        exoPlayer = null
        super.onDestroy()
    }

    companion object {
        const val ACTION_PLAY = "com.thegathering.player.PLAY"
        const val ACTION_PAUSE = "com.thegathering.player.PAUSE"
        const val ACTION_RESUME = "com.thegathering.player.RESUME"
        const val EXTRA_URI = "uri"
        const val EXTRA_TITLE = "title"
        const val EXTRA_ARTIST = "artist"
    }
}
