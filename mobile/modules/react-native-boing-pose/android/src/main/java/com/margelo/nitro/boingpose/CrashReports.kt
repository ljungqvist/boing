package com.margelo.nitro.boingpose

import android.os.Build
import com.margelo.nitro.NitroModules
import java.io.File
import java.io.PrintWriter
import java.io.StringWriter
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Records uncaught exceptions (any thread) to a file, so the app can show the report on the next
 * start: phones without developer mode have no other way to get a stack trace.
 */
object CrashReports {
  private const val NAME = "boing-crash.txt"
  @Volatile private var installed = false

  private fun file(): File? = NitroModules.applicationContext?.filesDir?.let { File(it, NAME) }

  fun install() {
    if (installed) return
    installed = true
    val previous = Thread.getDefaultUncaughtExceptionHandler()
    Thread.setDefaultUncaughtExceptionHandler { thread, e ->
      try {
        val trace = StringWriter().also { e.printStackTrace(PrintWriter(it)) }.toString()
        val time = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.ROOT).format(Date())
        file()?.writeText(
          "Boing crash, $time\n" +
            "Device: ${Build.MANUFACTURER} ${Build.MODEL}, Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})\n" +
            "Thread: ${thread.name}\n\n$trace",
        )
      } catch (_: Throwable) {
        // never get in the way of the crash itself
      }
      previous?.uncaughtException(thread, e)
    }
  }

  fun last(): String = file()?.takeIf { it.exists() }?.readText() ?: ""

  fun clear() {
    file()?.delete()
  }
}
