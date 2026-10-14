#include <jni.h>
#include <fbjni/fbjni.h>
#include "NitroBoingPoseOnLoad.hpp"

JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void*) {
  return facebook::jni::initialize(vm, []() {
    margelo::nitro::boingpose::registerAllNatives();
  });
}
