/**
 * Protocol Adapter Registry
 * 
 * Registry for protocol adapters and feature implementations.
 */

'use strict';

const Logger = require('../Utils/logger');
const { ErrorReporter, ErrorType } = require('../Utils/error-reporter');

/**
 * Registry for protocol adapters
 */
class ProtocolRegistry {
  /**
   * Create a new protocol registry
   */
  constructor() {
    this.adapters = {};
    this.featureImplementations = {};
    this.defaultImplementations = {};
    this.features = [];
    
    this.logger = new Logger('ProtocolRegistry');
    this.errorReporter = new ErrorReporter();
  }
  
  /**
   * Register a new adapter implementation
   * @param {import('./types').AdapterImplementation} adapter - The adapter to register
   */
  registerAdapter(adapter) {
    if (!adapter || !adapter.id || !adapter.targetVersion || !adapter.implementsFeatures || !adapter.moduleFactory) {
      throw new Error('Invalid adapter: missing required properties');
    }
    
    this.adapters[adapter.id] = adapter;
    
    // Register this adapter for each feature it implements
    adapter.implementsFeatures.forEach(featureId => {
      if (!this.featureImplementations[featureId]) {
        this.featureImplementations[featureId] = {};
      }
      
      this.featureImplementations[featureId][adapter.targetVersion.fullVersion] = adapter;
    });
    
    this.logger.debug(`Registered adapter ${adapter.id} for version ${adapter.targetVersion.fullVersion}`);
  }
  
  /**
   * Register a feature definition
   * @param {import('./types').ProtocolFeature} feature - The feature to register
   */
  registerFeature(feature) {
    if (!feature || !feature.id || !feature.name || !feature.endpoints || !feature.defaultImplementation) {
      throw new Error('Invalid feature: missing required properties');
    }
    
    this.features.push(feature);
    this.defaultImplementations[feature.id] = feature.defaultImplementation;
    
    this.logger.info(`Set ${feature.defaultImplementation} as default implementation for feature ${feature.id}`);
  }
  
  /**
   * Get adapter for a specific feature and version
   * @param {string} featureId - ID of the feature
   * @param {import('./types').ProtocolVersion} version - Protocol version
   * @returns {import('./types').AdapterImplementation|null} The adapter, or null if not found
   */
  getAdapter(featureId, version) {
    if (!featureId || !version) {
      throw new Error('Feature ID and version are required');
    }
    
    const featureImplementations = this.featureImplementations[featureId];
    if (!featureImplementations) {
      return this._getFallbackAdapter(featureId);
    }
    
    // First, try to find an exact match for the version
    if (featureImplementations[version.fullVersion]) {
      return featureImplementations[version.fullVersion];
    }
    
    // If not found, try to find a compatible version
    const compatibleVersions = Object.keys(featureImplementations)
      .filter(v => {
        const vParts = v.split('.');
        const majorVersion = parseInt(vParts[0], 10);
        return majorVersion === version.major;
      })
      .sort((a, b) => {
        const aParts = a.split('.').map(p => parseInt(p, 10));
        const bParts = b.split('.').map(p => parseInt(p, 10));
        
        // Compare major, minor, patch in order
        for (let i = 0; i < 3; i++) {
          if (aParts[i] !== bParts[i]) {
            return bParts[i] - aParts[i]; // Sort in descending order
          }
        }
        
        return 0;
      });
    
    if (compatibleVersions.length > 0) {
      const bestVersion = compatibleVersions[0];
      this.logger.debug(`Using compatible version ${bestVersion} for ${featureId} (requested ${version.fullVersion})`);
      return featureImplementations[bestVersion];
    }
    
    return this._getFallbackAdapter(featureId);
  }
  
  /**
   * Get the implementation module for a feature and version
   * @param {string} featureId - ID of the feature
   * @param {import('./types').ProtocolVersion} version - Protocol version
   * @returns {Object|null} The implementation module, or null if not found
   */
  getImplementation(featureId, version) {
    const adapter = this.getAdapter(featureId, version);
    if (!adapter) {
      const error = new Error(`No implementation found for feature ${featureId} and version ${version.fullVersion}`);
      this.errorReporter.reportError(
        error,
        ErrorType.FEATURE_UNAVAILABLE,
        { featureId, version: version.fullVersion }
      );
      throw error;
    }
    
    try {
      return adapter.moduleFactory();
    } catch (error) {
      this.errorReporter.reportError(
        error,
        ErrorType.IMPLEMENTATION_ERROR,
        { featureId, adapterId: adapter.id, version: version.fullVersion }
      );
      throw error;
    }
  }
  
  /**
   * Get all registered features
   * @returns {import('./types').ProtocolFeature[]} List of features
   */
  getFeatures() {
    return [...this.features];
  }
  
  /**
   * Get all registered adapters
   * @returns {Object.<string, import('./types').AdapterImplementation>} Map of adapters
   */
  getAdapters() {
    return { ...this.adapters };
  }
  
  /**
   * Get a fallback adapter for a feature
   * @private
   * @param {string} featureId - ID of the feature
   * @returns {import('./types').AdapterImplementation|null} The fallback adapter, or null if not found
   */
  _getFallbackAdapter(featureId) {
    const defaultImplementationId = this.defaultImplementations[featureId];
    if (!defaultImplementationId) {
      return null;
    }
    
    const adapter = this.adapters[defaultImplementationId];
    if (!adapter) {
      return null;
    }
    
    this.logger.warn(`Using fallback adapter ${adapter.id} for feature ${featureId}`);
    return adapter;
  }
}

module.exports = ProtocolRegistry;