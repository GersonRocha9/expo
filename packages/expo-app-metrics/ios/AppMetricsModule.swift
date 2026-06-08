import Foundation
import ExpoModulesCore
import EXUpdatesInterface

internal let logger = Logger(logHandlers: [createOSLogHandler(category: Logger.EXPO_LOG_CATEGORY)])

public final class AppMetricsModule: Module, UpdatesStateChangeListener {
  var subscription: UpdatesStateChangeSubscription?

  // Cached JS handles for the live sessions, so `getMainSession() === getMainSession()` holds while a
  // handle stays referenced. Held in a `Sendable` box (rather than on the module) so the `@Sendable`
  // async closure for `getForegroundSession` can capture just the cache instead of the whole module.
  private let sessionRefCache = SessionRefCache()

  public func definition() -> ModuleDefinition {
    // Captured by the session functions below so their closures reach the cache without capturing
    // `self`; the async `getForegroundSession` closure is `@Sendable` and couldn't capture the module.
    let sessionRefCache = self.sessionRefCache

    Name("ExpoAppMetrics")

    OnCreate {
      AppMetricsActor.isolated {
        AppMetrics.mainSession.updatesMonitor.patchAppInfoIfNeeded()
      }
      if let updatesController = UpdatesControllerRegistry.sharedInstance.controller {
        subscription = updatesController.subscribeToUpdatesStateChanges(self)
      }
    }

    OnDestroy {
      subscription?.remove()
    }

    Function("markFirstRender") {
      AppMetrics.mainSession.appStartupMonitor.markFirstRender()
    }

    Function("markInteractive") { (attributes: MetricAttributes?) in
      AppMetrics.mainSession.appStartupMonitor.markInteractive(
        routeName: attributes?.routeName,
        params: attributes?.params ?? [:]
      )
    }

    Function("logEvent") { (name: String, options: LogEventOptions?) in
      guard let validatedName = validateEventName(name) else {
        return
      }
      let validatedBody = validateEventBody(options?.body)
      let sanitized = sanitizeLogEventAttributes(options?.attributes)
      // Globals merge happens in `LogRow.from` so every persistence path picks them up.
      let record = LogRecord(
        name: validatedName,
        body: validatedBody,
        attributes: sanitized.attributes,
        droppedAttributesCount: sanitized.droppedCount,
        severity: options?.severity ?? .info
      )

      AppMetricsActor.isolated {
        AppMetrics.mainSession.receiveLog(record)
      }
    }

    Function("setGlobalAttributes") { (attributes: [String: Any]?) in
      GlobalAttributes.set(attributes)
    }

    AsyncFunction("getAppStartupTimesAsync") {
      return await AppMetrics.mainSession.appStartupMonitor.metrics
    }

    AsyncFunction("getMemoryUsageSnapshotAsync") {
      return try await AppMetricsActor.isolated {
        return MemoryUsageSnapshot.getCurrent()
      }
    }

    AsyncFunction("getFrameRateMetricsAsync") {
      return await AppMetrics.mainSession.frameMetricsRecorder.metrics
    }

    AsyncFunction("clearStoredEntries") {
      // no-op
    }

    // Debug-only: the inactive (ended) sessions
    AsyncFunction("getInactiveSessions") { () -> [StoredSession] in
      return try await AppMetricsActor.isolated {
        return try AppMetrics.database?
          .getInactiveSessionsWithChildren()
          .map { StoredSession(from: $0) } ?? []
      }.value
    }

    AsyncFunction("addCustomMetricToSession") { (jsMetric: JsMetric) in
      try await AppMetricsActor.isolated {
        let metric = jsMetric.toMetric()
        try AppMetrics.database?.insert(metric: MetricRow.from(metric: metric, sessionId: jsMetric.sessionId))
      }.value
    }

    // Synchronous and never nil: the main session is the process-lifetime singleton, always
    // available. We wrap the live instance (no storage round-trip) and cache the handle so repeated
    // calls return the same shared object.
    Function("getMainSession") { () -> SessionRef in
      return sessionRefCache.mainSession { SessionRef(AppMetrics.mainSession) }
    }

    // Returns the current foreground session, or `nil` when the app is not in the foreground.
    // Reads the actor-isolated `foregroundSession`, so it's async. The handle is cached and reused
    // while the same foreground session is current, and rebuilt when the session rotates, so the
    // reference is static per foreground session.
    AsyncFunction("getForegroundSession") { () -> SessionRef? in
      let session = try await AppMetricsActor.isolated { AppMetrics.foregroundSession }.value
      return sessionRefCache.foregroundSession(for: session) { SessionRef($0) }
    }

    Class("Session", SessionRef.self) {
      Property("id") { $0.ref.id }
      Property("type") { $0.ref.type.rawValue }
      Property("startDate") { $0.ref.startDate.ISO8601Format() }

      AsyncFunction("isActive") { (session: SessionRef) -> Bool in
        let liveSession = session.ref
        return try await AppMetricsActor.isolated { liveSession.isActive }.value
      }

      AsyncFunction("getEndDate") { (session: SessionRef) -> String? in
        let liveSession = session.ref
        return try await AppMetricsActor.isolated { liveSession.endDate?.ISO8601Format() }.value
      }

      AsyncFunction("getMetrics") { (session: SessionRef) -> [Metric] in
        let sessionId = session.ref.id
        return try await AppMetricsActor.isolated {
          let rows = try AppMetrics.database?.getMetrics(sessionId: sessionId) ?? []
          return decodeMetrics(from: rows)
        }.value
      }

      AsyncFunction("getLogs") { (session: SessionRef) -> [LogRecord] in
        let sessionId = session.ref.id
        return try await AppMetricsActor.isolated {
          let rows = try AppMetrics.database?.getLogs(sessionId: sessionId) ?? []
          return decodeLogs(from: rows)
        }.value
      }

      AsyncFunction("addMetric") { (session: SessionRef, input: SessionMetricInput) in
        let sessionId = session.ref.id
        try await AppMetricsActor.isolated {
          let metric = input.toMetric(sessionId: sessionId)
          try AppMetrics.database?.insert(metric: MetricRow.from(metric: metric, sessionId: sessionId))
        }.value
      }
    }

    Function("simulateCrashReport") {
      simulateCrashReport()
    }

    Function("triggerCrash") { (kind: CrashKind) in
      switch kind {
      case .badAccess: CrashTriggers.badAccess()
      case .fatalError: CrashTriggers.fatalErrorCrash()
      case .divideByZero: CrashTriggers.divideByZero()
      case .forceUnwrapNil: CrashTriggers.forceUnwrapNil()
      case .arrayOutOfBounds: CrashTriggers.arrayOutOfBounds()
      case .objcException: CrashTriggers.objcException()
      case .stackOverflow: CrashTriggers.stackOverflow()
      }
    }
  }

  public func updatesStateDidChange(_ event: [String : Any]) {
    if UpdatesStateEvent.fromDict(event)?.type ?? .restart == .downloadCompleteWithUpdate,
      let metric = AppMetrics.mainSession.updatesMonitor.downloadTimeMetric(subscription) {
      Task { @AppMetricsActor in
        AppMetrics.mainSession.updatesMonitor.reportMetric(metric)
      }
    }
  }
}

// Loads a session and its children from the database and wraps it as a `StoredSession`,
// returning `nil` when the database is unavailable or the session no longer exists.
@AppMetricsActor
private func storedSession(id: String) throws -> StoredSession? {
  guard let row = try AppMetrics.database?.getSessionWithChildren(id: id) else {
    return nil
  }
  return StoredSession(from: row)
}

struct MetricAttributes: Record {
  @Field var routeName: String?
  @Field var params: [String: Any]?
}

enum CrashKind: String, Enumerable {
  /// EXC_BAD_ACCESS / SIGSEGV — dereference of a bogus pointer.
  case badAccess
  /// EXC_CRASH / SIGABRT — Swift `fatalError`.
  case fatalError
  /// EXC_ARITHMETIC / SIGFPE — integer divide by zero.
  case divideByZero
  /// EXC_BAD_INSTRUCTION — force-unwrap of a nil optional.
  case forceUnwrapNil
  /// EXC_BAD_INSTRUCTION — out-of-bounds Swift array access.
  case arrayOutOfBounds
  /// Uncaught Objective-C `NSException`, populates MetricKit's `exceptionReason`.
  case objcException
  /// Stack overflow via unbounded recursion.
  case stackOverflow
}
