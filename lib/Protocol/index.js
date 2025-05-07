/**
 * Protocol Adaptation System
 * 
 * Main exports for the protocol adaptation system.
 */

'use strict';

const ProtocolAdapter = require('./adapter');
const ProtocolMonitor = require('./monitor');
const ProtocolRegistry = require('./registry');
const VersionDetector = require('./version-detector');
const ProtocolUpdater = require('./updater');
const WhatsAppClient = require('./whatsapp-client');

/**
 * Create a protocol adaptation system
 * @param {Object} options - Options for the protocol system
 * @returns {Object} The protocol system components
 */
function createProtocolSystem(options = {}) {
  const registry = new ProtocolRegistry();
  const versionDetector = new VersionDetector(options);
  const monitor = new ProtocolMonitor(options);
  const updater = new ProtocolUpdater({ registry, monitor });
  const adapter = new ProtocolAdapter(options);
  
  return {
    registry,
    versionDetector,
    monitor,
    updater,
    adapter
  };
}

module.exports = {
  ProtocolAdapter,
  ProtocolMonitor,
  ProtocolRegistry,
  VersionDetector,
  ProtocolUpdater,
  WhatsAppClient,
  createProtocolSystem
};