package com.margelo.nitro.boingpose

import android.graphics.Bitmap
import android.graphics.ImageFormat
import android.media.Image
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaCodecList
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import android.util.Log
import java.nio.ByteBuffer
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.TimeUnit

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

/** Rotation (degrees clockwise to upright) and duration (seconds) from the metadata alone: no pass over the samples. */
fun readRotationAndDuration(path: String): Pair<Int, Double> {
  val retriever = MediaMetadataRetriever()
  try {
    retriever.setDataSource(path)
    val rotation = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toIntOrNull() ?: 0
    val ms = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toDoubleOrNull() ?: 0.0
    return rotation to ms / 1e3
  } finally {
    retriever.release()
  }
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
 * the frames that `want(ptsUs)` accepts to `onFrame` as upright bitmaps. Stops after `toUs`, or as
 * soon as `stop()` says so. Returns the number of frames decoded (also those not wanted).
 */
fun decodeFrames(
  path: String,
  fromUs: Long,
  toUs: Long,
  rotation: Int,
  want: (ptsUs: Long) -> Boolean,
  onFrame: (ptsUs: Long, bitmap: Bitmap) -> Unit,
  stop: () -> Boolean = { false },
): Int {
  val extractor = MediaExtractor()
  var codec: MediaCodec? = null
  var decoded = 0
  try {
    extractor.setDataSource(path)
    val format = extractor.selectVideoTrack()
    val mime = format.getString(MediaFormat.KEY_MIME)!!
    if (fromUs > 0) extractor.seekTo(fromUs, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)
    format.setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420Flexible)
    val c = openDecoder(mime, format)
    codec = c
    c.start()
    val info = MediaCodec.BufferInfo()
    val copies = PlaneCopies()
    var inputDone = false
    while (!stop()) {
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
        if (info.size > 0) decoded++
        if (info.size > 0 && pts in fromUs..toUs && want(pts)) {
          val image = c.getOutputImage(o) ?: throw Error("The decoder gives no image")
          val bitmap = try {
            image.toUprightBitmap(MAX_SIDE, rotation, copies)
          } finally {
            image.close()
          }
          c.releaseOutputBuffer(o, false)
          onFrame(pts, bitmap)
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
  return decoded
}

/**
 * `decodeFrames` on a thread of its own, a few frames ahead of the caller: decoding and converting
 * the next frames overlaps with the pose inference on the current one. Same frames, same order.
 */
class FrameReader(
  path: String,
  fromUs: Long,
  toUs: Long,
  rotation: Int,
  want: (ptsUs: Long) -> Boolean,
) : AutoCloseable {
  class Frame(val ptsUs: Long, val bitmap: Bitmap)

  private class Failed(val error: Throwable)

  private val queue = ArrayBlockingQueue<Any>(AHEAD)
  @Volatile private var closed = false
  /** Time spent decoding and converting (not waiting for the caller), nanoseconds. */
  @Volatile var busyNs = 0L
    private set
  /** Frames decoded so far, including the ones not wanted. */
  @Volatile var decoded = 0
    private set

  private val thread = Thread({
    val start = System.nanoTime()
    var waitNs = 0L
    // Waits while the caller is behind; gives up when the caller has closed the reader.
    fun put(x: Any) {
      val t0 = System.nanoTime()
      while (!closed && !queue.offer(x, 50, TimeUnit.MILLISECONDS)) {
        // the caller is still busy with earlier frames
      }
      waitNs += System.nanoTime() - t0
    }
    try {
      decoded = decodeFrames(path, fromUs, toUs, rotation, want,
        onFrame = { pts, bitmap -> put(Frame(pts, bitmap)) },
        stop = { closed })
      busyNs = System.nanoTime() - start - waitNs
      put(END)
    } catch (e: Throwable) {
      busyNs = System.nanoTime() - start - waitNs
      put(Failed(e))
    }
  }, "BoingPoseDecode").apply { start() }

  /** The next wanted frame, or null after the last one; rethrows a decoding error. */
  fun next(): Frame? = when (val x = queue.take()) {
    END -> null
    is Failed -> throw x.error
    else -> x as Frame
  }

  override fun close() {
    closed = true
    queue.clear()
    thread.join()
  }

  private companion object {
    /** Frames decoded ahead of the caller (≈ 2 MB each at 540×960). */
    const val AHEAD = 3
    val END = Any()
  }
}

/**
 * A configured decoder for the format: the first one that accepts it, hardware decoders before
 * software ones. Budget chips reject some phone videos (e.g. 1080p at 60 fps), Android's software
 * decoders take them (slower).
 */
private fun openDecoder(mime: String, format: MediaFormat): MediaCodec {
  val infos = MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos
    .filter { !it.isEncoder && it.supportedTypes.any { t -> t.equals(mime, ignoreCase = true) } }
    .sortedBy { if (it.name.startsWith("c2.android.") || it.name.startsWith("OMX.google.")) 1 else 0 }
  var last: Throwable? = null
  for (info in infos) {
    val codec = MediaCodec.createByCodecName(info.name)
    try {
      codec.configure(format, null, null, 0)
      return codec
    } catch (e: Throwable) {
      Log.w("BoingPose", "Decoder ${info.name} can't take this video", e)
      codec.release()
      last = e
    }
  }
  throw Error("No decoder on this device can play this video ($mime): ${last?.message ?: "none found"}")
}

/** Longest side of the bitmaps handed to the pose model (it works on 256×256 internally). */
private const val MAX_SIDE = 1280

/** The decoder's planes copied out in bulk (much faster to read than byte by byte), reused from frame to frame. */
private class PlaneCopies {
  var y = ByteArray(0)
  var u = ByteArray(0)
  var v = ByteArray(0)
}

/** The whole buffer (from index 0, as `get(index)` reads it) in `old` if it fits, else in a new array. */
private fun ByteBuffer.copyInto(old: ByteArray): ByteArray {
  val b = duplicate()
  b.rewind()
  val n = b.remaining()
  val out = if (old.size >= n) old else ByteArray(n)
  b.get(out, 0, n)
  return out
}

/**
 * YUV 4:2:0 (8 bit) → upright ARGB bitmap: subsampled by an integer step so the longer side is at
 * most `maxSide`, and rotated clockwise by `rotation` (a multiple of 90) in the same pass. BT.601
 * limited range; small colour errors don't matter for pose. Pixel for pixel the same as converting
 * first and rotating the bitmap afterwards.
 */
private fun Image.toUprightBitmap(maxSide: Int, rotation: Int, copies: PlaneCopies): Bitmap {
  if (format != ImageFormat.YUV_420_888) throw Error("Unsupported decoder output format $format (10-bit HDR video?)")
  val crop = cropRect
  val step = maxOf(1, (maxOf(crop.width(), crop.height()) + maxSide - 1) / maxSide)
  val w = crop.width() / step
  val h = crop.height() / step
  val d = ((rotation % 360) + 360) % 360
  val sideways = d == 90 || d == 270
  val outW = if (sideways) h else w
  val outH = if (sideways) w else h
  val (yp, up, vp) = planes
  copies.y = yp.buffer.copyInto(copies.y)
  copies.u = up.buffer.copyInto(copies.u)
  copies.v = vp.buffer.copyInto(copies.v)
  val yb = copies.y
  val ub = copies.u
  val vb = copies.v
  val yRs = yp.rowStride
  val yPs = yp.pixelStride
  val uRs = up.rowStride
  val uPs = up.pixelStride
  val vRs = vp.rowStride
  val vPs = vp.pixelStride
  val pixels = IntArray(w * h)
  for (j in 0 until h) {
    // Where source pixel (0, j) lands in the rotated picture, and the step to (1, j).
    var dst: Int
    val di: Int
    when (d) {
      90 -> { dst = h - 1 - j; di = h }
      180 -> { dst = (h - 1 - j) * w + (w - 1); di = -1 }
      270 -> { dst = (w - 1) * h + j; di = -h }
      else -> { dst = j * w; di = 1 }
    }
    val sy = crop.top + j * step
    val yRow = sy * yRs
    val uRow = (sy / 2) * uRs
    val vRow = (sy / 2) * vRs
    for (i in 0 until w) {
      val sx = crop.left + i * step
      val y = (yb[yRow + sx * yPs].toInt() and 0xff) - 16
      val u = (ub[uRow + (sx / 2) * uPs].toInt() and 0xff) - 128
      val v = (vb[vRow + (sx / 2) * vPs].toInt() and 0xff) - 128
      val c = maxOf(0, y) * 1192
      val r = ((c + 1634 * v) shr 10).coerceIn(0, 255)
      val g = ((c - 833 * v - 400 * u) shr 10).coerceIn(0, 255)
      val b = ((c + 2066 * u) shr 10).coerceIn(0, 255)
      pixels[dst] = (0xff shl 24) or (r shl 16) or (g shl 8) or b
      dst += di
    }
  }
  return Bitmap.createBitmap(pixels, outW, outH, Bitmap.Config.ARGB_8888)
}
