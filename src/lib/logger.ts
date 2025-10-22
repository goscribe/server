import { createWriteStream, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
  TRACE = 4,
}

// Icons and colors for different log levels
const LOG_STYLES = {
  [LogLevel.ERROR]: {
    icon: '❌',
    color: '\x1b[31m', // Red
    bgColor: '\x1b[41m', // Red background
    bold: '\x1b[1m',
  },
  [LogLevel.WARN]: {
    icon: '⚠️ ',
    color: '\x1b[33m', // Yellow
    bgColor: '\x1b[43m', // Yellow background
    bold: '\x1b[1m',
  },
  [LogLevel.INFO]: {
    icon: 'ℹ️ ',
    color: '\x1b[36m', // Cyan
    bgColor: '\x1b[46m', // Cyan background
    bold: '\x1b[1m',
  },
  [LogLevel.DEBUG]: {
    icon: '🐛',
    color: '\x1b[35m', // Magenta
    bgColor: '\x1b[45m', // Magenta background
    bold: '\x1b[1m',
  },
  [LogLevel.TRACE]: {
    icon: '🔍',
    color: '\x1b[37m', // White
    bgColor: '\x1b[47m', // White background
    bold: '\x1b[1m',
  },
};

// Context icons for common services
const CONTEXT_ICONS: Record<string, string> = {
  'SERVER': '🖥️ ',
  'HTTP': '🌐',
  'API': '🔌',
  'AUTH': '🔐',
  'DATABASE': '🗄️ ',
  'DB': '🗄️ ',
  'TRPC': '⚡',
  'WORKSPACE': '📁',
  'WORKSHEET': '📝',
  'FLASHCARD': '🃏',
  'STUDYGUIDE': '📚',
  'PODCAST': '🎙️ ',
  'MEETING': '🤝',
  'CHAT': '💬',
  'FILE': '📄',
  'STORAGE': '💾',
  'CACHE': '⚡',
  'MIDDLEWARE': '🔧',
  'PERFORMANCE': '⚡',
  'SECURITY': '🛡️ ',
  'VALIDATION': '✅',
  'ERROR': '❌',
  'SUCCESS': '✅',
  'LOGGER': '📋',
};

export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  context?: string;
  metadata?: Record<string, any>;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

export interface LoggerConfig {
  level: LogLevel;
  enableConsole: boolean;
  enableFile: boolean;
  logDir?: string;
  maxFileSize?: number;
  maxFiles?: number;
  format?: 'json' | 'pretty';
}

class Logger {
  private config: LoggerConfig;
  private logStream?: NodeJS.WritableStream;

  constructor(config: Partial<LoggerConfig> = {}) {
    this.config = {
      level: LogLevel.INFO,
      enableConsole: true,
      enableFile: false,
      logDir: './logs',
      maxFileSize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
      format: 'pretty',
      ...config,
    };

    if (this.config.enableFile) {
      this.setupFileLogging();
    }
  }

  private setupFileLogging(): void {
    if (!this.config.logDir) return;

    // Ensure log directory exists
    if (!existsSync(this.config.logDir)) {
      mkdirSync(this.config.logDir, { recursive: true });
    }

    const logFile = join(this.config.logDir, `app-${new Date().toISOString().split('T')[0]}.log`);
    this.logStream = createWriteStream(logFile, { flags: 'a' });
  }

  private shouldLog(level: LogLevel): boolean {
    return level <= this.config.level;
  }

  private formatLogEntry(entry: LogEntry): string {
    if (this.config.format === 'json') {
      return JSON.stringify(entry) + '\n';
    }

    // Pretty format with enhanced styling
    const timestamp = this.formatTimestamp(entry.timestamp);
    const level = this.formatLevel(entry.level);
    const context = entry.context ? this.formatContext(entry.context) : '';
    const metadata = entry.metadata ? this.formatMetadata(entry.metadata) : '';
    const error = entry.error ? this.formatError(entry.error) : '';

    return `${timestamp} ${level} ${context}${entry.message}${metadata}${error}`;
  }

  private formatLevel(level: string): string {
    const levelNum = LogLevel[level as keyof typeof LogLevel];
    const style = LOG_STYLES[levelNum];
    return `${style.color}${style.bold}${level.padEnd(5)}\x1b[0m`;
  }

  private formatTimestamp(timestamp: string): string {
    const date = new Date(timestamp);
    const time = date.toLocaleTimeString('en-US', { 
      hour12: false, 
      hour: '2-digit', 
      minute: '2-digit', 
      second: '2-digit',
    });
    return `\x1b[90m${time}\x1b[0m`; // Gray color
  }

  private formatContext(context: string): string {
    const icon = CONTEXT_ICONS[context.toUpperCase()] || '📦';
    return `\x1b[94m${icon}${context}\x1b[0m `; // Blue color
  }

  private formatMetadata(metadata: Record<string, any>): string {
    const entries = Object.entries(metadata)
      .map(([key, value]) => {
        const formattedValue = this.formatValue(value);
        return `\x1b[93m${key}\x1b[0m=\x1b[96m${formattedValue}\x1b[0m`;
      })
      .join(' \x1b[90m|\x1b[0m ');
    
    return entries ? `\n  \x1b[90m└─\x1b[0m \x1b[90m{\x1b[0m ${entries} \x1b[90m}\x1b[0m` : '';
  }

  private formatValue(value: any): string {
    if (value === null) return '\x1b[90mnull\x1b[0m';
    if (value === undefined) return '\x1b[90mundefined\x1b[0m';
    if (typeof value === 'boolean') return value ? '\x1b[92mtrue\x1b[0m' : '\x1b[91mfalse\x1b[0m';
    if (typeof value === 'number') return `\x1b[95m${value}\x1b[0m`;
    if (typeof value === 'string') return `\x1b[96m"${value}"\x1b[0m`;
    if (typeof value === 'object') {
      if (Array.isArray(value)) {
        const items = value.map(item => this.formatValue(item)).join('\x1b[90m, \x1b[0m');
        return `\x1b[90m[\x1b[0m${items}\x1b[90m]\x1b[0m`;
      }
      const objEntries = Object.entries(value)
        .map(([k, v]) => `\x1b[93m${k}\x1b[0m:\x1b[96m${this.formatValue(v)}\x1b[0m`)
        .join('\x1b[90m, \x1b[0m');
      return `\x1b[90m{\x1b[0m${objEntries}\x1b[90m}\x1b[0m`;
    }
    return `\x1b[96m${String(value)}\x1b[0m`;
  }

  private formatError(error: { name: string; message: string; stack?: string }): string {
    let errorStr = `\n  \x1b[90m└─\x1b[0m \x1b[31m❌ \x1b[93m${error.name}\x1b[0m: \x1b[91m${error.message}\x1b[0m`;
    
    if (error.stack) {
      const stackLines = error.stack.split('\n').slice(1, 4); // Show first 3 stack lines
      errorStr += `\n    \x1b[90m└─ Stack:\x1b[0m`;
      stackLines.forEach((line, index) => {
        const isLast = index === stackLines.length - 1;
        const connector = isLast ? '└─' : '├─';
        errorStr += `\n      \x1b[90m${connector} \x1b[0m\x1b[90m${line.trim()}\x1b[0m`;
      });
    }
    
    return errorStr;
  }

  private log(level: LogLevel, message: string, context?: string, metadata?: Record<string, any>, error?: Error): void {
    if (!this.shouldLog(level)) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: LogLevel[level],
      message,
      context,
      metadata,
      error: error ? {
        name: error.name,
        message: error.message,
        stack: error.stack,
      } : undefined,
    };

    const formattedLog = this.formatLogEntry(entry);

    if (this.config.enableConsole) {
      // Enhanced console output with icons and colors
      const style = LOG_STYLES[level];
      const reset = '\x1b[0m';
      
      // Create a beautiful log line with proper spacing and colors
      const logLine = `${style.color}${style.icon} ${formattedLog}${reset}`;
      
      console.log(logLine);
    }

    if (this.config.enableFile && this.logStream) {
      this.logStream.write(formattedLog + '\n');
    }
  }

  error(message: string, context?: string, metadata?: Record<string, any>, error?: Error): void {
    this.log(LogLevel.ERROR, message, context, metadata, error);
  }

  warn(message: string, context?: string, metadata?: Record<string, any>): void {
    this.log(LogLevel.WARN, message, context, metadata);
  }

  info(message: string, context?: string, metadata?: Record<string, any>): void {
    this.log(LogLevel.INFO, message, context, metadata);
  }

  debug(message: string, context?: string, metadata?: Record<string, any>): void {
    this.log(LogLevel.DEBUG, message, context, metadata);
  }

  trace(message: string, context?: string, metadata?: Record<string, any>): void {
    this.log(LogLevel.TRACE, message, context, metadata);
  }

  // Convenience methods for common use cases
  http(method: string, url: string, statusCode: number, responseTime?: number, context?: string): void {
    const statusIcon = this.getHttpStatusIcon(statusCode);
    const responseTimeStr = responseTime ? `${responseTime}ms` : undefined;
    
    const metadata = {
      method,
      url,
      statusCode,
      responseTime: responseTimeStr,
    };
    
    this.info(`${statusIcon} ${method} ${url} - ${statusCode}`, context || 'HTTP', metadata);
  }

  private getHttpStatusIcon(statusCode: number): string {
    if (statusCode >= 200 && statusCode < 300) return '✅';
    if (statusCode >= 300 && statusCode < 400) return '↩️ ';
    if (statusCode >= 400 && statusCode < 500) return '⚠️ ';
    if (statusCode >= 500) return '❌';
    return '❓';
  }

  database(operation: string, table: string, duration?: number, context?: string): void {
    const operationIcon = this.getDatabaseOperationIcon(operation);
    const durationStr = duration ? `${duration}ms` : undefined;
    
    const metadata = {
      operation,
      table,
      duration: durationStr,
    };
    
    this.debug(`${operationIcon} ${operation} on ${table}`, context || 'DATABASE', metadata);
  }

  private getDatabaseOperationIcon(operation: string): string {
    const op = operation.toUpperCase();
    if (op.includes('SELECT')) return '🔍';
    if (op.includes('INSERT')) return '➕';
    if (op.includes('UPDATE')) return '✏️ ';
    if (op.includes('DELETE')) return '🗑️ ';
    if (op.includes('CREATE')) return '🏗️ ';
    if (op.includes('DROP')) return '💥';
    return '🗄️ ';
  }

  auth(action: string, userId?: string, context?: string): void {
    const metadata = {
      action,
      userId,
    };
    this.info(`Auth ${action}`, context, metadata);
  }

  trpc(procedure: string, input?: any, output?: any, duration?: number, context?: string): void {
    const metadata = {
      procedure,
      input: input ? JSON.stringify(input) : undefined,
      output: output ? JSON.stringify(output) : undefined,
      duration: duration ? `${duration}ms` : undefined,
    };
    this.debug(`tRPC ${procedure}`, context, metadata);
  }

  // Method to update configuration at runtime
  updateConfig(newConfig: Partial<LoggerConfig>): void {
    this.config = { ...this.config, ...newConfig };
    
    if (newConfig.enableFile && !this.logStream) {
      this.setupFileLogging();
    } else if (!newConfig.enableFile && this.logStream) {
      this.logStream.end();
      this.logStream = undefined;
    }
  }

  // Progress indicator for long-running operations
  progress(message: string, current: number, total: number, context?: string): void {
    const percentage = Math.round((current / total) * 100);
    const progressBar = this.createProgressBar(percentage);
    
    this.info(`${progressBar} ${message} (${current}/${total} - ${percentage}%)`, context || 'PROGRESS');
  }

  private createProgressBar(percentage: number, width: number = 20): string {
    const filled = Math.round((percentage / 100) * width);
    const empty = width - filled;
    const bar = '█'.repeat(filled) + '░'.repeat(empty);
    return `[${bar}]`;
  }

  // Success and failure helpers
  success(message: string, context?: string, metadata?: Record<string, any>): void {
    this.info(`✅ ${message}`, context, metadata);
  }

  failure(message: string, context?: string, metadata?: Record<string, any>, error?: Error): void {
    this.error(`❌ ${message}`, context, metadata, error);
  }

  // Method to close file streams (useful for graceful shutdown)
  close(): void {
    if (this.logStream) {
      this.logStream.end();
    }
  }
}

// Create default logger instance
const defaultConfig: Partial<LoggerConfig> = {
  level: process.env.NODE_ENV === 'production' ? LogLevel.INFO : LogLevel.DEBUG,
  enableConsole: true,
  enableFile: process.env.NODE_ENV === 'production',
  logDir: './logs',
  format: process.env.NODE_ENV === 'production' ? 'json' : 'pretty',
};

export const logger = new Logger(defaultConfig);

// Export the Logger class for custom instances
export { Logger };

// Graceful shutdown handling
process.on('SIGINT', () => {
  logger.info('Received SIGINT, closing logger...');
  logger.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('Received SIGTERM, closing logger...');
  logger.close();
  process.exit(0);
});
