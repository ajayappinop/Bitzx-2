package com.ibomobileapp

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.UiThreadUtil

class SplashModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "IboSplash"

  @ReactMethod
  fun hide() {
    val activity = reactApplicationContext.currentActivity ?: return
    UiThreadUtil.runOnUiThread {
      activity.setTheme(R.style.AppTheme)
    }
  }
}
