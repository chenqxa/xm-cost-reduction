type LogLevel = "info" | "warn" | "error" | "debug";

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  context?: Record<string, unknown>;
  error?: Error;
}

function formatLogEntry(entry: LogEntry): string {
  const { level, message, timestamp, context, error } = entry;
  let logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
  
  if (context && Object.keys(context).length > 0) {
    logMessage += ` | Context: ${JSON.stringify(context)}`;
  }
  
  if (error) {
    logMessage += ` | Error: ${error.message}`;
    if (error.stack) {
      logMessage += `\n${error.stack}`;
    }
  }
  
  return logMessage;
}

function createLogEntry(
  level: LogLevel,
  message: string,
  context?: Record<string, unknown>,
  error?: Error
): LogEntry {
  return {
    level,
    message,
    timestamp: new Date().toISOString(),
    context,
    error,
  };
}

export const logger = {
  info(message: string, context?: Record<string, unknown>) {
    const entry = createLogEntry("info", message, context);
    console.log(formatLogEntry(entry));
  },

  warn(message: string, context?: Record<string, unknown>) {
    const entry = createLogEntry("warn", message, context);
    console.warn(formatLogEntry(entry));
  },

  error(message: string, error?: Error, context?: Record<string, unknown>) {
    const entry = createLogEntry("error", message, context, error);
    console.error(formatLogEntry(entry));
  },

  debug(message: string, context?: Record<string, unknown>) {
    if (process.env.NODE_ENV === "development") {
      const entry = createLogEntry("debug", message, context);
      console.debug(formatLogEntry(entry));
    }
  },
};
