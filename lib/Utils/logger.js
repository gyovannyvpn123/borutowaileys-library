/**
 * Enhanced Logger for Protocol Adaptation System
 * 
 * Provides logging capabilities for the protocol adaptation system
 * with support for different log levels and contexts.
 */

'use strict';

/**
 * Log levels
 * @enum {number}
 */
const LogLevel = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3
};

/**
 * Enhanced logger for protocol adaptation system
 */
class Logger {
  /**
   * Create a new logger
   * @param {string} context - The context for this logger (typically a class name)
   * @param {Object} options - Logger options
   * @param {('debug'|'info'|'warn'|'error')} [options.level='info'] - Minimum log level
   * @param {boolean} [options.showTimestamp=true] - Whether to show timestamps
   * @param {boolean} [options.showContext=true] - Whether to show context
   */
  constructor(context, options = {}) {
    this.context = context || 'Logger';
    this.options = {
      level: 'info',
      showTimestamp: true,
      showContext: true,
      ...options
    };
    
    // Convert string level to enum
    if (typeof this.options.level === 'string') {
      this.options.level = {
        'debug': LogLevel.DEBUG,
        'info': LogLevel.INFO,
        'warn': LogLevel.WARN,
        'error': LogLevel.ERROR
      }[this.options.level.toLowerCase()] || LogLevel.INFO;
    }
  }
  
  /**
   * Log a debug message
   * @param {...any} args - Message and additional data to log
   */
  debug(...args) {
    this._log(LogLevel.DEBUG, ...args);
  }
  
  /**
   * Log an info message
   * @param {...any} args - Message and additional data to log
   */
  info(...args) {
    this._log(LogLevel.INFO, ...args);
  }
  
  /**
   * Log a warning message
   * @param {...any} args - Message and additional data to log
   */
  warn(...args) {
    this._log(LogLevel.WARN, ...args);
  }
  
  /**
   * Log an error message
   * @param {...any} args - Message and additional data to log
   */
  error(...args) {
    this._log(LogLevel.ERROR, ...args);
  }
  
  /**
   * Internal logging function
   * @private
   * @param {LogLevel} level - Log level
   * @param {...any} args - Data to log
   */
  _log(level, ...args) {
    if (level < this.options.level) {
      return;
    }
    
    const logFn = {
      [LogLevel.DEBUG]: console.debug,
      [LogLevel.INFO]: console.info,
      [LogLevel.WARN]: console.warn,
      [LogLevel.ERROR]: console.error
    }[level] || console.log;
    
    let prefix = '';
    
    if (this.options.showTimestamp) {
      prefix += `${new Date().toISOString()} `;
    }
    
    if (this.options.showContext) {
      const levelName = {
        [LogLevel.DEBUG]: 'DEBUG',
        [LogLevel.INFO]: 'INFO',
        [LogLevel.WARN]: 'WARN',
        [LogLevel.ERROR]: 'ERROR'
      }[level];
      
      prefix += `[${levelName}] [${this.context}] `;
    }
    
    if (prefix) {
      logFn(prefix, ...args);
    } else {
      logFn(...args);
    }
  }
}

module.exports = Logger;