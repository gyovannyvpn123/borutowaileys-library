# Protocol Adaptation System for @borutowaileys/library

This feature branch adds a Protocol Adaptation System to the WhatsApp library, allowing it to automatically adapt to WhatsApp protocol changes without manual intervention.

## Purpose

WhatsApp frequently updates its web client and protocol, which can break libraries that interact with it. This system solves that problem by:

1. Automatically detecting WhatsApp protocol versions
2. Monitoring for protocol changes in real-time
3. Adapting the library's behavior to maintain compatibility
4. Providing a consistent API regardless of the underlying protocol version

## Integration

The Protocol Adaptation System is integrated as a new module in the library:

```
lib/
└── Protocol/
    ├── adapter.js        - Protocol adapter system
    ├── index.js          - Main exports and system creation
    ├── monitor.js        - Protocol change monitoring
    ├── registry.js       - Adapter registry for different versions
    ├── types.js          - Type definitions for protocol system
    ├── updater.js        - Protocol update management
    ├── version-detector.js - Protocol version detection
    └── whatsapp-client.js  - Enhanced client implementation
```

## Using Protocol Adaptation

The system is designed to be used transparently. Applications can continue using the library's existing API, and the protocol adaptation will happen automatically in the background.

For applications that want more control over protocol adaptation:

```javascript
const { createProtocolSystem } = require('@borutowaileys/library/lib/Protocol');
const { WhatsAppClient } = require('@borutowaileys/library/lib/Protocol/whatsapp-client');

// Create the protocol system with custom options
const client = new WhatsAppClient({
  protocol: {
    monitoringStrategy: 'hybrid',
    pollingInterval: 60 * 60 * 1000, // 1 hour
    enableRuntimeChecks: true
  },
  onProtocolUpdate: (oldVersion, newVersion) => {
    console.log(`WhatsApp protocol updated from ${oldVersion} to ${newVersion}`);
    // You might want to send a notification or log this event
  }
});

// The client can be used normally, with protocol adaptation happening automatically
await client.connect();
await client.sendMessage('1234567890', 'Hello, world!');
```

## Configuration

The protocol adaptation system can be configured via:

1. Constructor options when creating clients
2. Configuration file at `config/protocol-config.json`

See `docs/auto-update-system.md` for detailed configuration options and architecture overview.

## Benefits

- **Reduced Maintenance**: No need for emergency updates when WhatsApp changes its protocol
- **Increased Reliability**: Applications continue to function even after WhatsApp updates
- **Future-Proof**: New protocol versions are automatically supported
- **Backward Compatibility**: Older protocol versions remain supported
- **Transparency**: Protocol changes are logged and reported

## License

This code is provided under the same license as the core library.