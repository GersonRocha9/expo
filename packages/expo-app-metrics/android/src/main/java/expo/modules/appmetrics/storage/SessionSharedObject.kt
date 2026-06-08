package expo.modules.appmetrics.storage

import expo.modules.kotlin.AppContext
import expo.modules.kotlin.sharedobjects.SharedObject

class SessionSharedObject(
  val sessionId: String,
  val type: String,
  val startDate: String,
  appContext: AppContext
) : SharedObject(appContext)
