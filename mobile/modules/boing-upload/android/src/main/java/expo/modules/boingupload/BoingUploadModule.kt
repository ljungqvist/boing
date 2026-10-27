package expo.modules.boingupload

import android.content.Intent
import androidx.core.content.ContextCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class BoingUploadModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("BoingUpload")

    // Called from the foreground (a clip was kept, or the app started), which is when Android
    // allows a foreground service to start.
    Function("start") { dir: String, server: String, phoneId: String, key: String ->
      val context = appContext.reactContext ?: return@Function
      val intent = Intent(context, UploadService::class.java)
        .putExtra(UploadService.DIR, dir)
        .putExtra(UploadService.SERVER, server)
        .putExtra(UploadService.PHONE, phoneId)
        .putExtra(UploadService.KEY, key)
      ContextCompat.startForegroundService(context, intent)
    }

    Function("stop") {
      appContext.reactContext?.let { it.stopService(Intent(it, UploadService::class.java)) }
      Unit
    }
  }
}
