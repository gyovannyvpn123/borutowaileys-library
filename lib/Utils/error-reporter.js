/**
 * Error Reporter for Protocol Adaptation System
 * 
 * Collects and reports errors related to protocol adaptation.
 */

'use strict';

const Logger = require('./logger');

/**
 * Error types for protocol adaptation
 * @enum {string}
 */
const ErrorType = {
  DETECTION_FAILED: 'detection_failed',
  ADAPTATION_FAILED: 'adaptation_failed',
  FEATURE_UNAVAILABLE: 'feature_unavailable',
  IMPLEMENTATION_ERROR: 'implementation_error',
  CONNECTION_FAILED: 'connection_failed',
  PROTOCOL_MISMATCH: 'protocol_mismatch',
  UNKNOWN: 'unknown'
};

/**
 * Error reporter for protocol adaptation
 */
class ErrorReporter {
  /**
   * Create a new error reporter
   * @param {Object} options - Options for error reporting
   * @param {boolean} [options.enableRemoteReporting=false] - Whether to enable remote error reporting
   * @param {string} [options.remoteEndpoint=''] - Endpoint for remote error reporting
   * @param {boolean} [options.includeStackTrace=true] - Whether to include stack traces in reports
   */
  constructor(options = {}) {
    this.options = {
      enableRemoteReporting: false,
      remoteEndpoint: '',
      includeStackTrace: true,
      ...options
    };
    
    this.errorCounts = Object.values(ErrorType).reduce((acc, type) => {
      acc[type] = 0;
      return acc;
    }, {});
    
    this.logger = new Logger('ErrorReporter');
  }
  
  /**
   * Report an error
   * @param {Error} error - The error to report
   * @param {ErrorType} [type=ErrorType.UNKNOWN] - Type of error
   * @param {Object} [context={}] - Additional context for the error
   */
  reportError(error, type = ErrorType.UNKNOWN, context = {}) {
    this.errorCounts[type] = (this.errorCounts[type] || 0) + 1;
    
    const errorData = {
      type,
      message: error.message,
      stack: this.options.includeStackTrace ? error.stack : undefined,
      timestamp: new Date().toISOString(),
      context
    };
    
    this.logger.error(`Protocol error [${type}]:`, error.message, context);
    
    if (this.options.enableRemoteReporting && this.options.remoteEndpoint) {
      this._sendRemoteReport(errorData).catch(reportError => {
        this.logger.error('Failed to send remote error report:', reportError.message);
      });
    }
    
    return errorData;
  }
  
  /**
   * Get error count for a specific type
   * @param {ErrorType} type - Error type
   * @returns {number} Number of errors of this type
   */
  getErrorCount(type) {
    return this.errorCounts[type] || 0;
  }
  
  /**
   * Get total error count across all types
   * @returns {number} Total number of errors
   */
  getTotalErrorCount() {
    return Object.values(this.errorCounts).reduce((total, count) => total + count, 0);
  }
  
  /**
   * Reset error counts
   * @param {ErrorType} [type] - Specific type to reset, or all if not specified
   */
  resetErrorCounts(type) {
    if (type) {
      this.errorCounts[type] = 0;
    } else {
      Object.keys(this.errorCounts).forEach(key => {
        this.errorCounts[key] = 0;
      });
    }
  }
  
  /**
   * Send error report to remote endpoint
   * @private
   * @param {Object} errorData - Error data to send
   * @returns {Promise<void>}
   */
  async _sendRemoteReport(errorData) {
    // In a real implementation, this would send the error data to a remote endpoint
    // using fetch, axios, or a similar HTTP client
    this.logger.debug('Would send remote error report:', errorData);
  }
}

// Export error types and class
module.exports = {
  ErrorReporter,
  ErrorType
};