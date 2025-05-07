/**
 * Protocol Updater
 * 
 * Manages protocol updates and adapter switching.
 */

'use strict';

const EventEmitter = require('events');
const Logger = require('../Utils/logger');
const { ErrorReporter, ErrorType } = require('../Utils/error-reporter');

/**
 * Protocol updater for managing protocol changes
 * @extends EventEmitter
 */
class ProtocolUpdater extends EventEmitter {
  /**
   * Create a new protocol updater
   * @param {Object} options - Options
   * @param {Object} options.registry - Protocol registry
   * @param {Object} options.monitor - Protocol monitor
   */
  constructor({ registry, monitor }) {
    super();
    
    if (!registry) {
      throw new Error('Registry is required');
    }
    
    if (!monitor) {
      throw new Error('Monitor is required');
    }
    
    this.registry = registry;
    this.monitor = monitor;
    this.logger = new Logger('ProtocolUpdater');
    this.errorReporter = new ErrorReporter();
    this.currentVersion = null;
    this.featureAdapters = {};
    
    this._setupEventListeners();
  }
  
  /**
   * Initialize the updater with a version
   * @param {import('./types').ProtocolVersion} version - Initial protocol version
   */
  initialize(version) {
    this.currentVersion = version;
    this.logger.info('Protocol updater initialized');
  }
  
  /**
   * Shut down the updater
   */
  shutdown() {
    this.logger.info('Protocol updater stopped');
  }
  
  /**
   * Set up event listeners for monitor events
   * @private
   */
  _setupEventListeners() {
    this.monitor.on('version:updated', (oldVersion, newVersion) => {
      this.updateAdaptersForVersion(newVersion);
    });
  }
  
  /**
   * Check for protocol updates
   * @returns {Promise<boolean>} Whether an update was found
   */
  async checkForUpdates() {
    return this.monitor.checkForUpdates();
  }
  
  /**
   * Handle error threshold being reached for a feature
   * @param {string} featureId - ID of the feature that reached error threshold
   * @param {import('./types').ProtocolVersion} currentVersion - Current protocol version
   */
  handleErrorThreshold(featureId, currentVersion) {
    this.logger.warn(`Error threshold reached for feature ${featureId}, checking for better adapters`);
    
    // For now, we'll just check for protocol updates
    // In a real implementation, we might try to find a different adapter for this feature
    this.checkForUpdates().catch(error => {
      this.logger.error('Error checking for updates:', error.message);
    });
  }
  
  /**
   * Update adapters for a new version
   * @param {import('./types').ProtocolVersion} newVersion - New protocol version
   */
  updateAdaptersForVersion(newVersion) {
    if (!newVersion) {
      return;
    }
    
    this.currentVersion = newVersion;
    
    try {
      // For each registered feature, check if we need to update the adapter
      const features = this.registry.getFeatures();
      
      for (const feature of features) {
        const featureId = feature.id;
        const oldAdapter = this.featureAdapters[featureId];
        const newAdapter = this.registry.getAdapter(featureId, newVersion);
        
        if (!oldAdapter || !newAdapter) {
          this.featureAdapters[featureId] = newAdapter;
          continue;
        }
        
        // If the adapters are different, emit an event
        if (oldAdapter.id !== newAdapter.id) {
          this.logger.info(`Updating adapter for feature ${featureId}: ${oldAdapter.id} -> ${newAdapter.id}`);
          this.featureAdapters[featureId] = newAdapter;
          this.emit('adapter:updated', featureId, oldAdapter.id, newAdapter.id);
        }
      }
    } catch (error) {
      this.errorReporter.reportError(
        error,
        ErrorType.ADAPTATION_FAILED,
        { method: 'updateAdaptersForVersion', version: newVersion.fullVersion }
      );
    }
  }
  
  /**
   * Find the best adapter for a feature and version
   * @param {string} featureId - ID of the feature
   * @param {import('./types').ProtocolVersion} version - Protocol version
   * @returns {import('./types').AdapterImplementation|null} Best adapter, or null if none found
   * @private
   */
  _findBestAdapter(featureId, version) {
    const allAdapters = this.registry.getAdapters();
    const compatibleAdapters = Object.values(allAdapters)
      .filter(adapter => 
        adapter.implementsFeatures.includes(featureId) &&
        adapter.targetVersion.major === version.major
      );
    
    if (compatibleAdapters.length === 0) {
      return null;
    }
    
    // Sort by version similarity (higher versions first)
    compatibleAdapters.sort((a, b) => {
      // First priority: exact match
      if (a.targetVersion.fullVersion === version.fullVersion) return -1;
      if (b.targetVersion.fullVersion === version.fullVersion) return 1;
      
      // Second priority: minor version
      if (a.targetVersion.minor === version.minor && b.targetVersion.minor !== version.minor) return -1;
      if (b.targetVersion.minor === version.minor && a.targetVersion.minor !== version.minor) return 1;
      
      // Third priority: closest minor version
      const minorDiffA = Math.abs(a.targetVersion.minor - version.minor);
      const minorDiffB = Math.abs(b.targetVersion.minor - version.minor);
      if (minorDiffA !== minorDiffB) return minorDiffA - minorDiffB;
      
      // Fourth priority: closest patch version
      const patchDiffA = Math.abs(a.targetVersion.patch - version.patch);
      const patchDiffB = Math.abs(b.targetVersion.patch - version.patch);
      return patchDiffA - patchDiffB;
    });
    
    return compatibleAdapters[0];
  }
}

module.exports = ProtocolUpdater;