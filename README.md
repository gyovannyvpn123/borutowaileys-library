
# @borutowaileys/library

A powerful library for building WhatsApp applications and bots.

## Features

- Multi-device support
- Message sending and receiving
- Group management
- Media handling
- QR code authentication
- Event-based messaging
- Message history synchronization
- Comprehensive API for all WhatsApp features

## Installation

```bash
npm install @borutowaileys/library
```

## Quick Start

```javascript
const { default: makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@borutowaileys/library');
const { Boom } = require('@hapi/boom');

// Simple example of how to use the library
async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true
    });
    
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if(connection === 'close') {
            const shouldReconnect = (lastDisconnect.error instanceof Boom && 
                lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut);
                
            if(shouldReconnect) {
                connectToWhatsApp();
            }
        } else if(connection === 'open') {
            console.log('Successfully connected to WhatsApp');
        }
    });
    
    sock.ev.on('creds.update', saveCreds);
    
    sock.ev.on('messages.upsert', async ({ messages }) => {
        if(messages[0].key.fromMe) return;
        
        const message = messages[0];
        console.log('Received message:', message.message);
        
        // Simple echo bot
        await sock.sendMessage(message.key.remoteJid, {
            text: 'You said: ' + message.message.conversation
        });
    });
}

connectToWhatsApp();
```


## Funcționalități Avansate

Biblioteca @borutowaileys/library include următoarele funcționalități avansate:

### Rate Limiting

Prevenirea blocării de către WhatsApp prin limitarea numărului de mesaje trimise:

```javascript
const { makeEnhancedWASocket } = require('@borutowaileys/library');

const sock = makeEnhancedWASocket({
  rateLimiter: {
    maxRequests: 15,  // Numărul maxim de cereri
    timeWindow: 60000 // Fereastra de timp (1 minut)
  }
});

// Trimitere mesaj cu rate limiting
try {
  await sock.sendWithRateLimit(jid, { text: 'Mesaj cu rate limiting' });
} catch (error) {
  console.log(error.message); // "Rate limit exceeded. Try again in X seconds."
}
```

### Procesare Imagini și OCR

Extragere text din imagini și procesare avansată:

```javascript
// Extragere text din imagine
const text = await sock.extractTextFromImage(imageBuffer);
console.log('Text extras:', text);

// Comprimare imagine
const compressedImage = await sock.compressImage(imageBuffer, 80); // calitate 80%

// Redimensionare imagine
const resizedImage = await sock.resizeImage(imageBuffer, 800, 600);

// Adăugare watermark
const watermarkedImage = await sock.addWatermark(imageBuffer, watermarkBuffer, {
  opacity: 0.5,
  x: 10,
  y: 10
});
```

### Gestionare Avansată a Grupurilor

Funcționalități extinse pentru administrarea grupurilor:

```javascript
// Creare grup cu opțiuni avansate
const group = await sock.createGroupWithOptions('Numele Grupului', ['123456789@s.whatsapp.net'], {
  description: 'Descriere grup',
  picture: fs.readFileSync('icon.jpg'),
  restrict: true // Grup anunț (doar admini pot scrie)
});

// Programare acțiuni pentru grup
await sock.scheduleGroupAction(
  groupId,
  'message',            // Tipul acțiunii: message, title, description, remove, add, promote, demote
  Date.now() + 3600000, // Timestamp pentru 1 oră în viitor
  { message: { text: 'Mesaj programat' } }
);

// Obținere acțiuni programate
const actions = sock.getScheduledGroupActions(groupId);

// Anulare acțiune programată
sock.cancelScheduledGroupAction(actionId);
```

### Webhook-uri pentru Integrări

Notificare servicii externe despre evenimente WhatsApp:

```javascript
// Configurare webhook
sock.setupWebhook('https://example.com/webhook', ['message.received', 'message.sent']);

// Trimitere mesaj fără notificare webhook
await sock.sendMessage(jid, { text: 'Mesaj silențios' }, { silentWebhook: true });

// Eliminare webhook
sock.removeWebhook('https://example.com/webhook');
```

### Cache Îmbunătățit

Stocare eficientă a datelor cu persistență și TTL:

```javascript
// Stocare în cache
sock.cacheSet('key', value, 3600); // TTL de 1 oră

// Obținere din cache
const value = sock.cacheGet('key');

// Eliminare din cache
sock.cacheDelete('key');

// Golire cache
sock.cacheClear();
```
## Documentation

For detailed documentation on all the available functions and features, please refer to the docs folder.

## License

MIT
