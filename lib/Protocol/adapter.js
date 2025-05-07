/**
 * Protocol Adapter
 * 
 * Adapts WhatsApp API requests to the appropriate protocol version.
 */

'use strict';

const EventEmitter = require('events');
const Logger = require('../Utils/logger');
const { ErrorReporter, ErrorType } = require('../Utils/error-reporter');
const ProtocolRegistry = require('./registry');
const ProtocolMonitor = require('./monitor');
const VersionDetector = require('./version-detector');
const ProtocolUpdater = require('./updater');

/**
 * Protocol adapter for handling WhatsApp protocol changes
 * @extends EventEmitter
 */
class ProtocolAdapter extends EventEmitter {
  /**
   * Create a new protocol adapter
   * @param {import('./types').ProtocolAdapterOptions} options - Adapter options
   */
  constructor(options = {}) {
    super();
    
    this.options = {
      strategy: 'hybrid',
      pollingInterval: 3600000,
      enableRuntimeChecks: true,
      errorThreshold: 5,
      userAgent: 'WhatsApp/2.2345.12 (Web)',
      ...options
    };
    
    this.registry = new ProtocolRegistry();
    this.logger = new Logger('ProtocolAdapter');
    this.errorReporter = new ErrorReporter();
    
    this.versionDetector = new VersionDetector({
      useMockVersion: options.useMockVersion || false,
      userAgent: this.options.userAgent
    });
    
    this.monitor = new ProtocolMonitor({
      strategy: this.options.strategy,
      pollingInterval: this.options.pollingInterval,
      runtimeChecksEnabled: this.options.enableRuntimeChecks,
      errorThreshold: this.options.errorThreshold,
      useMockVersion: options.useMockVersion || false,
      userAgent: this.options.userAgent
    });
    
    this.updater = new ProtocolUpdater({
      registry: this.registry,
      monitor: this.monitor
    });
    
    this.currentVersion = null;
    this.featureCache = {};
    
    this._setupEventListeners();
  }
  
  /**
   * Set up event listeners for monitor and updater events
   * @private
   */
  _setupEventListeners() {
    this.monitor.on('version:updated', (oldVersion, newVersion) => {
      this.currentVersion = newVersion;
      this.featureCache = {}; // Clear cache on version update
      this.emit('version:updated', oldVersion, newVersion);
    });
    
    this.monitor.on('errors:threshold_reached', (count, featureId) => {
      this.emit('errors:threshold_reached', count, featureId);
      this.updater.handleErrorThreshold(featureId, this.currentVersion);
    });
    
    this.monitor.on('runtime:potential_protocol_change', (errors) => {
      this.emit('runtime:potential_protocol_change', errors);
      this.updater.checkForUpdates();
    });
    
    this.updater.on('adapter:updated', (featureId, oldImplementation, newImplementation) => {
      this.featureCache = {}; // Clear cache when adapters are updated
      this.emit('adapter:updated', featureId, oldImplementation, newImplementation);
    });
  }
  
  /**
   * Initialize the protocol adapter
   * @returns {Promise<import('./types').ProtocolVersion>} The detected protocol version
   */
  async initialize() {
    try {
      this.currentVersion = await this.versionDetector.detectVersion();
      
      this.logger.info(`Initializing Protocol Adapter for version ${this.currentVersion.fullVersion}`);
      
      // Start monitoring for protocol changes
      await this.monitor.start();
      
      // Initialize protocol updater
      this.updater.initialize(this.currentVersion);
      
      return this.currentVersion;
    } catch (error) {
      this.errorReporter.reportError(
        error,
        ErrorType.DETECTION_FAILED,
        { method: 'initialize' }
      );
      
      throw error;
    }
  }
  
  /**
   * Shut down the protocol adapter
   */
  shutdown() {
    this.monitor.stop();
    this.updater.shutdown();
    this.featureCache = {};
  }
  
  /**
   * Register a protocol adapter implementation
   * @param {import('./types').AdapterImplementation} adapter - The adapter to register
   */
  registerAdapter(adapter) {
    this.registry.registerAdapter(adapter);
  }
  
  /**
   * Register a feature definition
   * @param {import('./types').ProtocolFeature} feature - The feature to register
   */
  registerFeature(feature) {
    this.registry.registerFeature(feature);
  }
  
  /**
   * Get an implementation for a specific feature
   * @param {string} featureId - ID of the feature
   * @returns {Object} The implementation for this feature
   */
  getFeatureImplementation(featureId) {
    if (!this.currentVersion) {
      throw new Error('Protocol adapter not initialized');
    }
    
    // Check cache first
    if (this.featureCache[featureId]) {
      return this.featureCache[featureId];
    }
    
    try {
      const implementation = this.registry.getImplementation(featureId, this.currentVersion);
      
      // Cache the implementation
      this.featureCache[featureId] = implementation;
      
      return implementation;
    } catch (error) {
      this.errorReporter.reportError(
        error,
        ErrorType.FEATURE_UNAVAILABLE,
        { featureId, version: this.currentVersion.fullVersion }
      );
      
      throw error;
    }
  }
  
  /**
   * Execute a feature with automatic protocol adaptation
   * @param {string} featureId - ID of the feature to execute
   * @param {string} methodName - Name of the method to call
   * @param {Array} args - Arguments to pass to the method
   * @returns {Promise<any>} Result of the method call
   */
  async executeFeature(featureId, methodName, ...args) {
    try {
      const implementation = this.getFeatureImplementation(featureId);
      
      if (!implementation[methodName]) {
        throw new Error(`Method ${methodName} not found in feature ${featureId}`);
      }
      
      const result = await implementation[methodName](...args);
      
      // Report success
      this.monitor.reportFeatureSuccess(featureId);
      
      return result;
    } catch (error) {
      // Check if this might be a protocol error
      if (this._isLikelyProtocolError(error)) {
        const thresholdReached = this.monitor.reportRuntimeError(
          error,
          featureId,
          { methodName, args }
        );
        
        if (thresholdReached) {
          // If threshold reached, try to adapt immediately
          await this.updater.checkForUpdates();
          
          // Try one more time with potentially updated implementation
          this.featureCache = {}; // Clear cache
          const implementation = this.getFeatureImplementation(featureId);
          
          if (implementation[methodName]) {
            return implementation[methodName](...args);
          }
        }
      }
      
      throw error;
    }
  }
  
  /**
   * Check if an error is likely to be caused by a protocol change
   * @private
   * @param {Error} error - The error to check
   * @returns {boolean} Whether this error might indicate a protocol change
   */
  _isLikelyProtocolError(error) {
    // Common patterns that suggest protocol errors
    const protocolErrorPatterns = [
      'invalid protocol',
      'unknown field',
      'method not found',
      'incompatible version',
      'protocol error',
      'message format',
      'unexpected response',
      'invalid structure'
    ];
    
    if (!error || !error.message) {
      return false;
    }
    
    const message = error.message.toLowerCase();
    return protocolErrorPatterns.some(pattern => message.includes(pattern));
  }
  
  /**
   * Get current protocol version
   * @returns {import('./types').ProtocolVersion} Current protocol version
   */
  getCurrentVersion() {
    return this.currentVersion;
  }
  
  /**
   * Check for protocol updates
   * @returns {Promise<boolean>} Whether an update was found
   */
  async checkForUpdates() {
    return this.updater.checkForUpdates();
  }
}

module.exports = ProtocolAdapter;