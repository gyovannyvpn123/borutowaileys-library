/**
 * Protocol Monitor
 * 
 * Monitors WhatsApp protocol for changes and notifies when updates are detected.
 */

'use strict';

const EventEmitter = require('events');
const Logger = require('../Utils/logger');
const { ErrorReporter, ErrorType } = require('../Utils/error-reporter');
const VersionDetector = require('./version-detector');

/**
 * Protocol monitor for detecting WhatsApp protocol changes
 * @extends EventEmitter
 */
class ProtocolMonitor extends EventEmitter {
  /**
   * Create a new protocol monitor
   * @param {import('./types').MonitorOptions} options - Monitor options
   */
  constructor(options = {}) {
    super();
    
    this.options = {
      strategy: 'hybrid',
      pollingInterval: 3600000,
      runtimeChecksEnabled: true,
      runtimeCheckInterval: 900000,
      errorThreshold: 5,
      ...options
    };
    
    this.logger = new Logger('ProtocolMonitor');
    this.errorReporter = new ErrorReporter();
    this.versionDetector = new VersionDetector({
      useMockVersion: options.useMockVersion || false,
      userAgent: options.userAgent
    });
    
    this.currentVersion = null;
    this.isRunning = false;
    this.pollingTimer = null;
    this.runtimeCheckTimer = null;
    this.featureTestResults = {};
  }
  
  /**
   * Start monitoring for protocol changes
   * @returns {Promise<void>}
   */
  async start() {
    if (this.isRunning) {
      return;
    }
    
    try {
      // Detect current version
      this.currentVersion = await this.versionDetector.detectVersion();
      
      // Start polling if enabled
      if (this.options.strategy === 'polling' || this.options.strategy === 'hybrid') {
        this._startVersionPolling();
      }
      
      // Start runtime checks if enabled
      if (this.options.runtimeChecksEnabled && 
          (this.options.strategy === 'runtime' || this.options.strategy === 'hybrid')) {
        this._startRuntimeChecks();
      }
      
      this.isRunning = true;
      
      this.logger.info(`Protocol monitoring started with strategy: ${this.options.strategy}`);
      this.emit('monitoring:started', this.currentVersion);
    } catch (error) {
      this.errorReporter.reportError(
        error, 
        ErrorType.DETECTION_FAILED, 
        { method: 'start' }
      );
      
      throw error;
    }
  }
  
  /**
   * Stop monitoring for protocol changes
   */
  stop() {
    if (!this.isRunning) {
      return;
    }
    
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
    
    if (this.runtimeCheckTimer) {
      clearInterval(this.runtimeCheckTimer);
      this.runtimeCheckTimer = null;
    }
    
    this.isRunning = false;
    
    this.logger.info('Protocol monitoring stopped');
    this.emit('monitoring:stopped');
  }
  
  /**
   * Manually check for protocol updates
   * @returns {Promise<boolean>} Whether an update was detected
   */
  async checkForUpdates() {
    try {
      const newVersion = await this.versionDetector.detectVersion();
      
      if (!this.currentVersion) {
        this.currentVersion = newVersion;
        return false;
      }
      
      // Compare versions
      if (newVersion.fullVersion !== this.currentVersion.fullVersion) {
        const oldVersion = this.currentVersion;
        this.currentVersion = newVersion;
        
        this.logger.info(`Protocol version updated: ${oldVersion.fullVersion} -> ${newVersion.fullVersion}`);
        this.emit('version:updated', oldVersion, newVersion);
        
        return true;
      }
      
      return false;
    } catch (error) {
      this.errorReporter.reportError(
        error, 
        ErrorType.DETECTION_FAILED, 
        { method: 'checkForUpdates' }
      );
      
      return false;
    }
  }
  
  /**
   * Report a runtime error that might indicate a protocol change
   * @param {Error} error - The error that occurred
   * @param {string} featureId - ID of the feature that failed
   * @param {Object} [context={}] - Additional context
   * @returns {boolean} Whether the error count has reached the threshold
   */
  reportRuntimeError(error, featureId, context = {}) {
    this.errorReporter.reportError(
      error, 
      ErrorType.PROTOCOL_MISMATCH, 
      { featureId, ...context }
    );
    
    this.featureTestResults[featureId] = {
      success: false,
      lastError: error,
      context,
      timestamp: Date.now()
    };
    
    // Check if we've hit the error threshold
    const errorCount = this.errorReporter.getErrorCount(ErrorType.PROTOCOL_MISMATCH);
    const thresholdReached = errorCount >= this.options.errorThreshold;
    
    if (thresholdReached) {
      this.logger.warn(`Protocol error threshold reached (${errorCount}/${this.options.errorThreshold})`);
      this.emit('errors:threshold_reached', errorCount, featureId);
    }
    
    return thresholdReached;
  }
  
  /**
   * Report a successful feature operation
   * @param {string} featureId - ID of the feature that succeeded
   */
  reportFeatureSuccess(featureId) {
    // Reset error count for this feature
    this.featureTestResults[featureId] = {
      success: true,
      lastError: null,
      timestamp: Date.now()
    };
  }
  
  /**
   * Start polling for version updates
   * @private
   */
  _startVersionPolling() {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
    }
    
    this.logger.info(`Version polling started with interval: ${this.options.pollingInterval}ms`);
    
    this.pollingTimer = setInterval(async () => {
      try {
        await this.checkForUpdates();
      } catch (error) {
        this.logger.error('Error polling for version updates:', error.message);
      }
    }, this.options.pollingInterval);
  }
  
  /**
   * Start runtime feature testing
   * @private
   */
  _startRuntimeChecks() {
    if (this.runtimeCheckTimer) {
      clearInterval(this.runtimeCheckTimer);
    }
    
    this.logger.info(`Runtime feature testing started with interval: ${this.options.runtimeCheckInterval}ms`);
    
    this.runtimeCheckTimer = setInterval(() => {
      this._checkFeatureErrors();
    }, this.options.runtimeCheckInterval);
  }
  
  /**
   * Check for patterns in feature errors that might indicate protocol changes
   * @private
   */
  _checkFeatureErrors() {
    const now = Date.now();
    const recentErrors = Object.entries(this.featureTestResults)
      .filter(([_, result]) => !result.success && 
        now - result.timestamp < this.options.runtimeCheckInterval * 2);
    
    if (recentErrors.length >= 2) {
      this.logger.warn(`Multiple features failing: ${recentErrors.map(([id]) => id).join(', ')}`);
      this.emit('runtime:potential_protocol_change', recentErrors);
    }
  }
}

module.exports = ProtocolMonitor;