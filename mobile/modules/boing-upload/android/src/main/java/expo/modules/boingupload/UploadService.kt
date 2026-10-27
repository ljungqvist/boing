package expo.modules.boingupload

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/**
 * Uploads the kept jumps while the app is in the background. Every folder in `dir` that has a
 * `.ready` file is one jump (its clip and session.json); it's sent file by file
 * (PUT <server>/upload?session=<folder>_<phone>&name=…), marked complete (POST <server>/done) and
 * deleted from the phone. A folder stays until the server has confirmed everything, so a failed
 * round only means another try after a wait (5 s, doubling to 5 min); the service gives up after
 * a few rounds without progress and starts again when the app next asks (a new clip, a start).
 */
class UploadService : Service() {
  companion object {
    const val DIR = "dir"
    const val SERVER = "server"
    const val PHONE = "phone"
    const val KEY = "key"
    private const val CHANNEL = "boing_upload"
    private const val NOTIFICATION_ID = 4711
    private const val MAX_ROUNDS_WITHOUT_PROGRESS = 8
    private const val FIRST_WAIT_MS = 5_000L
    private const val MAX_WAIT_MS = 300_000L
  }

  private class Config(val dir: File, val server: String, val phone: String, val key: String)

  private val lock = Any()
  private var worker: Thread? = null // guarded by lock
  private var rescan = false // guarded by lock
  @Volatile private var stopped = false
  private var lastStartId = 0 // guarded by lock
  @Volatile private var current: HttpURLConnection? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    startAsForeground("Uploading recordings…")
    val dir = intent?.getStringExtra(DIR)
    val server = intent?.getStringExtra(SERVER)
    val phone = intent?.getStringExtra(PHONE)
    if (dir == null || server == null || phone == null) {
      stopSelf(startId)
      return START_NOT_STICKY
    }
    val config = Config(File(dir), server.trimEnd('/'), phone, intent.getStringExtra(KEY) ?: "")
    synchronized(lock) {
      lastStartId = startId
      if (worker == null) {
        stopped = false
        worker = Thread({ work(config) }, "boing-upload").also { it.start() }
      } else {
        rescan = true
      }
    }
    // After a kill the system delivers the last intent again, so a queued upload carries on.
    return START_REDELIVER_INTENT
  }

  override fun onDestroy() {
    stopped = true
    synchronized(lock) { worker?.interrupt() }
    current?.disconnect()
    super.onDestroy()
  }

  /** The worker thread: rounds until nothing is left or nothing works, then the service stops. */
  private fun work(config: Config) {
    var exitId = 0
    try {
      while (true) {
        rounds(config)
        // A start that came in meanwhile (a new clip) gets another go before the service stops.
        val again = synchronized(lock) {
          if (rescan && !stopped) {
            rescan = false
            true
          } else {
            worker = null
            exitId = lastStartId
            false
          }
        }
        if (!again) break
      }
    } finally {
      synchronized(lock) {
        if (worker === Thread.currentThread()) { worker = null; exitId = lastStartId }
      }
      // A start with a newer id is not stopped by this (and then has its own worker).
      stopSelf(exitId)
    }
  }

  /** Sends what is ready, again and again with growing waits; returns when empty or without progress. */
  private fun rounds(config: Config) {
    var wait = FIRST_WAIT_MS
    var withoutProgress = 0
    while (!stopped) {
      val jobs = readyFolders(config.dir)
      if (jobs.isEmpty()) return
      var progress = false
      for ((i, job) in jobs.withIndex()) {
        if (stopped) return
        notify("Uploading recordings: ${i + 1} of ${jobs.size}")
        if (send(config, job)) progress = true
      }
      if (progress) { withoutProgress = 0; wait = FIRST_WAIT_MS; continue }
      if (++withoutProgress >= MAX_ROUNDS_WITHOUT_PROGRESS) return
      notify("Waiting to upload ${jobs.size} recording${if (jobs.size == 1) "" else "s"}")
      try { Thread.sleep(wait) } catch (_: InterruptedException) { return }
      wait = minOf(wait * 2, MAX_WAIT_MS)
    }
  }

  private fun readyFolders(dir: File): List<File> =
    (dir.listFiles() ?: emptyArray()).filter { it.isDirectory && File(it, ".ready").exists() }.sortedBy { it.name }

  /** Sends one jump folder and deletes it; false if anything failed (it's tried again later). */
  private fun send(config: Config, job: File): Boolean {
    return try {
      val folder = URLEncoder.encode("${job.name}_${config.phone}", "UTF-8")
      val files = (job.listFiles() ?: emptyArray()).filter { it.isFile && !it.name.startsWith(".") }
      // The clips first, session.json last: a complete folder is what gwb fetches.
      for (f in files.sortedBy { it.name == "session.json" }) {
        val name = URLEncoder.encode(f.name, "UTF-8")
        if (request("${config.server}/upload?session=$folder&name=$name", "PUT", config.key, f) !in 200..299) return false
      }
      if (request("${config.server}/done?session=$folder", "POST", config.key, null) !in 200..299) return false
      job.deleteRecursively()
      true
    } catch (_: Exception) {
      false // no network, connection dropped, cancelled: tried again later
    }
  }

  private fun request(url: String, method: String, key: String, body: File?): Int {
    val c = URL(url).openConnection() as HttpURLConnection
    current = c
    try {
      c.requestMethod = method
      c.connectTimeout = 20_000
      c.readTimeout = 120_000
      if (key.isNotEmpty()) c.setRequestProperty("X-Boing-Key", key)
      c.doOutput = true
      if (body != null) {
        c.setRequestProperty("Content-Type", "application/octet-stream")
        c.setFixedLengthStreamingMode(body.length())
        body.inputStream().use { input -> c.outputStream.use { out -> input.copyTo(out, 64 * 1024) } }
      } else {
        c.setFixedLengthStreamingMode(0)
        c.outputStream.close()
      }
      val code = c.responseCode
      (if (code >= 400) c.errorStream else c.inputStream)?.use { it.readBytes() }
      return code
    } finally {
      current = null
      c.disconnect()
    }
  }

  private fun startAsForeground(text: String) {
    val manager = getSystemService(NotificationManager::class.java)
    if (manager.getNotificationChannel(CHANNEL) == null) {
      manager.createNotificationChannel(NotificationChannel(CHANNEL, "Uploading recordings", NotificationManager.IMPORTANCE_LOW))
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTIFICATION_ID, notification(text), ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    } else {
      startForeground(NOTIFICATION_ID, notification(text))
    }
  }

  private fun notify(text: String) =
    getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, notification(text))

  private fun notification(text: String): Notification =
    Notification.Builder(this, CHANNEL)
      .setSmallIcon(android.R.drawable.stat_sys_upload)
      .setContentTitle("Boing")
      .setContentText(text)
      .setOngoing(true)
      .build()
}
