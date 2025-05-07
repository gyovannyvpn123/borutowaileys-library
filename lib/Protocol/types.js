/**
 * Protocol Adaptation System Types
 * 
 * Type definitions for the protocol adaptation system.
 */

'use strict';

/**
 * WhatsApp protocol version
 * @typedef {Object} ProtocolVersion
 * @property {number} major - Major version number
 * @property {number} minor - Minor version number
 * @property {number} patch - Patch version number
 * @property {string} fullVersion - Full version string (e.g. "2.2345.12")
 */

/**
 * Feature implementation for a specific protocol version
 * @typedef {Object} AdapterImplementation
 * @property {string} id - Unique identifier for this implementation
 * @property {ProtocolVersion} targetVersion - The protocol version this implementation is designed for
 * @property {string[]} implementsFeatures - List of feature IDs this adapter implements
 * @property {Function} moduleFactory - Factory function that creates the actual implementation
 */

/**
 * Protocol adapter options
 * @typedef {Object} ProtocolAdapterOptions
 * @property {string} [strategy='hybrid'] - Version detection strategy ('polling', 'runtime', 'hybrid')
 * @property {number} [pollingInterval=3600000] - Interval for polling version updates (in ms)
 * @property {boolean} [enableRuntimeChecks=true] - Whether to check for runtime protocol issues
 * @property {number} [errorThreshold=5] - Number of errors before triggering adaptation
 * @property {string} [userAgent='WhatsApp/2.2345.12 (Web)'] - User agent to use for requests
 */

/**
 * Monitor options for protocol monitoring
 * @typedef {Object} MonitorOptions
 * @property {string} [strategy='hybrid'] - Monitoring strategy ('polling', 'runtime', 'hybrid')
 * @property {number} [pollingInterval=3600000] - Interval for polling version updates (in ms)
 * @property {boolean} [runtimeChecksEnabled=true] - Whether to enable runtime checks
 * @property {number} [runtimeCheckInterval=900000] - Interval for runtime checks (in ms)
 * @property {number} [errorThreshold=5] - Number of errors before triggering adaptation
 */

/**
 * Protocol feature definition
 * @typedef {Object} ProtocolFeature
 * @property {string} id - Unique identifier for the feature
 * @property {string} name - Human-readable name
 * @property {string[]} endpoints - List of endpoint patterns that belong to this feature
 * @property {string} defaultImplementation - ID of the default implementation
 */

// Export dummy values for compatibility with JavaScript
// These are only used for documentation purposes
module.exports = {
  dummyProtocolVersion: {
    major: 2,
    minor: 2345,
    patch: 12,
    fullVersion: '2.2345.12'
  },
  
  dummyAdapterImplementation: {
    id: 'message-sending-v2.2345.12',
    targetVersion: {
      major: 2,
      minor: 2345,
      patch: 12,
      fullVersion: '2.2345.12'
    },
    implementsFeatures: ['sendMessage', 'sendMedia'],
    moduleFactory: () => ({})
  },
  
  dummyProtocolAdapterOptions: {
    strategy: 'hybrid',
    pollingInterval: 3600000,
    enableRuntimeChecks: true,
    errorThreshold: 5,
    userAgent: 'WhatsApp/2.2345.12 (Web)'
  },
  
  dummyMonitorOptions: {
    strategy: 'hybrid',
    pollingInterval: 3600000,
    runtimeChecksEnabled: true,
    runtimeCheckInterval: 900000,
    errorThreshold: 5
  },
  
  dummyProtocolFeature: {
    id: 'sendMessage',
    name: 'Message Sending',
    endpoints: ['message', 'text', 'chat'],
    defaultImplementation: 'message-sending-v2.2345.12'
  }
};