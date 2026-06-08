// Copyright 2025-present 650 Industries. All rights reserved.

import ExpoModulesCore

/**
 JS-facing handle to a live session, exposed as the `Session` class. Carries the native `Session`
 instance itself (the singleton `MainSession`, or the current `ForegroundSession`), so a JS
 reference keeps the native instance alive — no id registry needed.

 Mutable state (`isActive`, `endDate`) is read live from the wrapped instance; metrics and logs are
 read from the database by the `Class("Session", …)` async methods. 
 */
final class SessionRef: SharedRef<Session> {
  override var nativeRefType: String {
    "session"
  }
}

/**
 Thread-safe cache for the live-session JS handles backing `getMainSession` / `getForegroundSession`.

 Kept in its own `Sendable` box rather than as plain module fields so the `@Sendable` async-function
 closure for `getForegroundSession` can capture just this cache instead of forcing
 `@unchecked Sendable` onto the whole module. The internal lock serializes every access and is never
 held across a suspension point.
 */
final class SessionRefCache: @unchecked Sendable {
  private let lock = NSLock()
  private var mainSessionRef: SessionRef?
  private var foregroundSessionRef: SessionRef?

  /// Returns the cached main-session handle, creating it once via `make` on first use. Returning the
  /// same instance every call makes the shared-object registry hand JS the identical object.
  func mainSession(_ make: () -> SessionRef) -> SessionRef {
    return lock.withLock {
      if let mainSessionRef {
        return mainSessionRef
      }
      let ref = make()
      mainSessionRef = ref
      return ref
    }
  }

  /// Returns the cached handle for the current foreground `session`: reused while the same session is
  /// current, rebuilt when it rotates, and cleared when there is no foreground session.
  func foregroundSession(for session: Session?, _ make: (Session) -> SessionRef) -> SessionRef? {
    return lock.withLock {
      guard let session else {
        foregroundSessionRef = nil
        return nil
      }
      if let cached = foregroundSessionRef, cached.ref === session {
        return cached
      }
      let ref = make(session)
      foregroundSessionRef = ref
      return ref
    }
  }
}
