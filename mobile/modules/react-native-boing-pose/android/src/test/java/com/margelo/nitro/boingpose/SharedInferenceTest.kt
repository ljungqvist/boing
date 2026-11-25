package com.margelo.nitro.boingpose

import org.junit.Assert.assertEquals
import org.junit.Test

class SharedInferenceTest {
  private val gb = 1024L * 1024 * 1024
  private fun helpers(asked: Int, cores: Int, memGb: Double, lowRam: Boolean = false) =
    SharedInference.helpersFor(asked, cores, (memGb * gb).toLong(), lowRam)

  @Test
  fun coresLeaveTwoForTheGpuPathThenOnePerThree() {
    assertEquals(2, helpers(2, 8, 8.0))
    assertEquals(2, helpers(3, 8, 8.0))
    assertEquals(1, helpers(2, 6, 8.0))
    assertEquals(0, helpers(2, 4, 8.0))
    assertEquals(0, helpers(2, 2, 8.0))
    assertEquals(3, helpers(4, 12, 12.0))
  }

  @Test
  fun memoryCapsIt() {
    // The Galaxy Tab A8: 8 cores, 2.4 GB.
    assertEquals(1, helpers(2, 8, 2.4))
    assertEquals(2, helpers(2, 8, 3.0))
    assertEquals(0, helpers(2, 8, 4.0, lowRam = true))
  }

  @Test
  fun neverMoreThanAsked() {
    assertEquals(0, helpers(0, 8, 8.0))
    assertEquals(1, helpers(1, 8, 8.0))
    assertEquals(0, helpers(-1, 8, 8.0))
  }
}
