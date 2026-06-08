import { NativeModule, registerWebModule } from 'expo';

import type { Session } from './Session';
import type {
  ExpoAppMetricsModuleType,
  LogAttributeValue,
  LogEventOptions,
  LogRecord,
  Metric,
  MetricAttributes,
  MetricInput,
  SessionType,
} from './types';

export * from './types';

class WebSession extends globalThis.expo.SharedObject {
  readonly id = 'web-session';
  readonly startDate = new Date().toISOString();

  constructor(readonly type: SessionType = 'main') {
    super();
  }

  async isActive(): Promise<boolean> {
    return true;
  }
  async getEndDate(): Promise<string | null> {
    return null;
  }
  async getMetrics(): Promise<Metric[]> {
    return [];
  }
  async getLogs(): Promise<LogRecord[]> {
    return [];
  }
  async addMetric(_metric: MetricInput): Promise<void> {
    throw new Error('Method not implemented.');
  }
}

class ExpoAppMetricsModule extends NativeModule implements ExpoAppMetricsModuleType {
  Session = WebSession as unknown as typeof Session;

  addCustomMetricToSession(metric: Metric): Promise<void> {
    throw new Error('Method not implemented.');
  }

  async markFirstRender() {}
  async markInteractive(attributes?: MetricAttributes) {}
  logEvent(name: string, options?: LogEventOptions) {}
  setGlobalAttributes(attributes?: Record<string, LogAttributeValue> | null) {}
  async clearStoredEntries() {}
  async getInactiveSessions() {
    return [];
  }
  simulateCrashReport() {}
  triggerCrash() {}
  getMainSession(): Session {
    throw new Error('Method not implemented.');
  }
  async getForegroundSession() {
    return null;
  }
}

export default registerWebModule(ExpoAppMetricsModule, 'ExpoAppMetrics');
