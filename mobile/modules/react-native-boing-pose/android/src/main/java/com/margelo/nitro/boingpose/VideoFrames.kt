package com.margelo.nitro.boingpose

import android.graphics.Bitmap
import android.graphics.ImageFormat
import android.media.Image
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever

/** Index and format of the first video track. */
private fun MediaExtractor.selectVideoTrack(): MediaFormat {
  for (i in 0 until trackCount) {
    val f = getTrackFormat(i)
    if (f.getString(MediaFormat.KEY_MIME)?.startsWith("video/") == true) {
      selectTrack(i)
      return f
    }
  }
  throw Error("No video track in this file")
}

fun readVideoInfo(path: String): VideoInfo {
  val retriever = MediaMetadataRetriever()
  try {
    retriever.setDataSource(path)
    fun meta(key: Int) = retriever.extractMetadata(key)
    val rotation = meta(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toIntOrNull() ?: 0
    val w = meta(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toDoubleOrNull() ?: 0.0
    val h = meta(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toDoubleOrNull() ?: 0.0
    val capture = meta(MediaMetadataRetriever.METADATA_KEY_CAPTURE_FRAMERATE)?.toDoubleOrNull() ?: 0.0
    // Count samples and their time span directly (no decoding): exact for variable frame rates.
    val extractor = MediaExtractor()
    val times = ArrayList<Long>()
    var durationUs = 0L
    try {
      extractor.setDataSource(path)
      val format = extractor.selectVideoTrack()
      if (format.containsKey(MediaFormat.KEY_DURATION)) durationUs = format.getLong(MediaFormat.KEY_DURATION)
      while (true) {
        val t = extractor.sampleTime
        if (t < 0) break
        times.add(t)
        if (!extractor.advance()) break
      }
    } finally {
      extractor.release()
    }
    // Samples come in decode order; presentation order is sorted time.
    times.sort()
    val count = times.size
    val span = if (count > 1) (times[count - 1] - times[0]) / 1e6 else 0.0
    val fps = if (span > 0) (count - 1) / span else 0.0
    val gaps = (1 until count).map { times[it] - times[it - 1] }.filter { it > 0 }.sorted()
    val peakFps = if (gaps.isNotEmpty()) 1e6 / gaps[gaps.size / 20] else fps
    val upright = rotation % 180 != 0
    return VideoInfo(
      width = if (upright) h else w,
      height = if (upright) w else h,
      duration = if (durationUs > 0) durationUs / 1e6 else span,
      frameCount = count.toDouble(),
      fps = fps,
      peakFps = peakFps,
      captureFps = capture,
      rotation = rotation.toDouble(),
    )
  } finally {
    retriever.release()
  }
}

/**
 * Decodes every frame of the video track in order (from the key frame before `fromUs`) and hands
 * the frames that `want(ptsUs)` accepts to `onFrame` as upright bitmaps. Stops after `toUs`.
 */
fun decodeFrames(
  path: String,
  fromUs: Long,
  toUs: Long,
  rotation: Int,
  want: (ptsUs: Long) -> Boolean,
  onFrame: (ptsUs: Long, bitmap: Bitmap) -> Unit,
) {
  val extractor = MediaExtractor()
  var codec: MediaCodec? = null
  try {
    extractor.setDataSource(path)
    val format = extractor.selectVideoTrack()
    val mime = format.getString(MediaFormat.KEY_MIME)!!
    if (fromUs > 0) extractor.seekTo(fromUs, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)
    format.setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420Flexible)
    val c = MediaCodec.createDecoderByType(mime)
    codec = c
    c.configure(format, null, null, 0)
    c.start()
    val info = MediaCodec.BufferInfo()
    var inputDone = false
    while (true) {
      if (!inputDone) {
        val i = c.dequeueInputBuffer(10_000)
        if (i >= 0) {
          val buf = c.getInputBuffer(i)!!
          val size = extractor.readSampleData(buf, 0)
          val t = extractor.sampleTime
          // Frames are reordered by the decoder: keep feeding a little past the window's end.
          if (size < 0 || t > toUs + 500_000) {
            c.queueInputBuffer(i, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
            inputDone = true
          } else {
            c.queueInputBuffer(i, 0, size, t, 0)
            extractor.advance()
          }
        }
      }
      val o = c.dequeueOutputBuffer(info, 10_000)
      if (o >= 0) {
        val pts = info.presentationTimeUs
        val eos = info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0
        if (info.size > 0 && pts in fromUs..toUs && want(pts)) {
          val image = c.getOutputImage(o) ?: throw Error("The decoder gives no image")
          val bitmap = try {
            image.toBitmapScaled(MAX_SIDE)
          } finally {
            image.close()
          }
          c.releaseOutputBuffer(o, false)
          onFrame(pts, bitmap.rotated(rotation))
        } else {
          c.releaseOutputBuffer(o, false)
        }
        if (eos || pts > toUs) break
      }
    }
  } finally {
    try {
      codec?.stop()
    } catch (_: Throwable) {
    }
    codec?.release()
    extractor.release()
  }
}

/** Longest side of the bitmaps handed to the pose model (it works on 256×256 internally). */
private const val MAX_SIDE = 1280

/**
 * YUV 4:2:0 (8 bit) → ARGB bitmap, subsampled by an integer step so the longer side is at most
 * `maxSide`. BT.601 limited range; small colour errors don't matter for pose.
 */
private fun Image.toBitmapScaled(maxSide: Int): Bitmap {
  if (format != ImageFormat.YUV_420_888) throw Error("Unsupported decoder output format $format (10-bit HDR video?)")
  val crop = cropRect
  val step = maxOf(1, (maxOf(crop.width(), crop.height()) + maxSide - 1) / maxSide)
  val w = crop.width() / step
  val h = crop.height() / step
  val (yp, up, vp) = planes
  val yb = yp.buffer
  val ub = up.buffer
  val vb = vp.buffer
  val pixels = IntArray(w * h)
  for (j in 0 until h) {
    val sy = crop.top + j * step
    val yRow = sy * yp.rowStride
    val uRow = (sy / 2) * up.rowStride
    val vRow = (sy / 2) * vp.rowStride
    for (i in 0 until w) {
      val sx = crop.left + i * step
      val y = (yb.get(yRow + sx * yp.pixelStride).toInt() and 0xff) - 16
      val u = (ub.get(uRow + (sx / 2) * up.pixelStride).toInt() and 0xff) - 128
      val v = (vb.get(vRow + (sx / 2) * vp.pixelStride).toInt() and 0xff) - 128
      val c = maxOf(0, y) * 1192
      val r = ((c + 1634 * v) shr 10).coerceIn(0, 255)
      val g = ((c - 833 * v - 400 * u) shr 10).coerceIn(0, 255)
      val b = ((c + 2066 * u) shr 10).coerceIn(0, 255)
      pixels[j * w + i] = (0xff shl 24) or (r shl 16) or (g shl 8) or b
    }
  }
  return Bitmap.createBitmap(pixels, w, h, Bitmap.Config.ARGB_8888)
}
