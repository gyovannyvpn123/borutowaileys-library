/**
 * @borutowaileys/library - Versiune avansată a bibliotecii pentru WhatsApp
 * Acest fișier extinde funcționalitatea originală cu module avansate
 */

// Importurile de bază
const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@borutowaileys/library');

// Importurile modulelor noastre avansate
const RateLimiter = require('./rate-limiter');
const EnhancedCache = require('./enhanced-cache');
const WebhookSender = require('./webhook-sender');
const ImageProcessor = require('./image-processor');
const GroupManager = require('./group-manager');

/**
 * Creează un socket WhatsApp cu funcționalități îmbunătățite
 * @param {Object} options Opțiunile pentru socket
 * @returns {Object} Socket-ul îmbunătățit
 */
function makeEnhancedWASocket(options = {}) {
  // Creăm socket-ul de bază
  const sock = makeWASocket(options);
  
  // Adăugăm funcționalitățile noi
  sock.rateLimiter = new RateLimiter(options.rateLimiter);
  sock.enhancedCache = new EnhancedCache(options.cacheOptions);
  sock.webhooks = new WebhookSender(options.webhooks);
  sock.imageProcessor = new ImageProcessor(options.imageProcessor);
  sock.groupManager = new GroupManager(sock);
  
  // Integrăm modulele în socket pentru o experiență unitară
  
  // Metode pentru extragerea textului din imagini
  sock.extractTextFromImage = async (buffer, options) => {
    return await sock.imageProcessor.extractTextFromImage(buffer, options);
  };
  
  // Metode pentru procesarea imaginilor
  sock.resizeImage = async (buffer, width, height) => {
    return await sock.imageProcessor.resizeImage(buffer, width, height);
  };
  
  sock.compressImage = async (buffer, quality) => {
    return await sock.imageProcessor.compressImage(buffer, quality);
  };
  
  sock.addWatermark = async (imageBuffer, watermarkBuffer, options) => {
    return await sock.imageProcessor.addWatermark(imageBuffer, watermarkBuffer, options);
  };
  
  // Metodă pentru trimitere cu rate limiting
  sock.sendWithRateLimit = async (jid, content, options = {}) => {
    if (sock.rateLimiter.canMakeRequest(jid)) {
      const result = await sock.sendMessage(jid, content, options);
      return result;
    } else {
      const remaining = sock.rateLimiter.getRemainingTime(jid);
      throw new Error(`Rate limit exceeded. Try again in ${Math.ceil(remaining/1000)} seconds.`);
    }
  };
  
  // Metode pentru webhook-uri
  sock.setupWebhook = (url, events, headers) => {
    sock.webhooks.addWebhook(url, events, headers);
    return sock; // Pentru chaining
  };
  
  sock.removeWebhook = (url) => {
    return sock.webhooks.removeWebhook(url);
  };
  
  // Metode pentru grupuri îmbunătățite
  sock.createGroupWithOptions = async (name, participants, options) => {
    return await sock.groupManager.createGroup(name, participants, options);
  };
  
  sock.scheduleGroupAction = async (groupId, action, time, params) => {
    return await sock.groupManager.scheduleAction(groupId, action, time, params);
  };
  
  sock.getScheduledGroupActions = (groupId) => {
    return sock.groupManager.getScheduledActions(groupId);
  };
  
  sock.cancelScheduledGroupAction = (actionId) => {
    return sock.groupManager.cancelScheduledAction(actionId);
  };
  
  // Integrare webhook-uri cu evenimente existente
  const originalSendMessage = sock.sendMessage;
  sock.sendMessage = async (jid, content, options = {}) => {
    const result = await originalSendMessage(jid, content, options);
    // Notificăm webhook-urile doar dacă nu există opțiunea de silence
    if (!options.silentWebhook) {
      sock.webhooks.send('message.sent', { jid, content, options, result });
    }
    return result;
  };
  
  // Hook pentru evenimentele de mesaje primite
  const originalMessageUpsertHandler = sock.ev.on.bind(sock.ev, 'messages.upsert');
  sock.ev.on = function(event, listener) {
    if (event === 'messages.upsert') {
      const enhancedListener = async (upsert) => {
        // Notificăm webhook-urile
        sock.webhooks.send('message.received', upsert);
        
        // Apelăm listener-ul original
        return await listener(upsert);
      };
      
      return originalMessageUpsertHandler(enhancedListener);
    }
    
    // Pentru alte evenimente, păstrăm comportamentul original
    return sock.ev._events[event] = sock.ev._events[event] || [];
  };
  
  // Metode pentru cache îmbunătățit
  sock.cacheSet = (key, value, ttl) => {
    return sock.enhancedCache.set(key, value, ttl);
  };
  
  sock.cacheGet = (key) => {
    return sock.enhancedCache.get(key);
  };
  
  sock.cacheDelete = (key) => {
    return sock.enhancedCache.delete(key);
  };
  
  sock.cacheClear = () => {
    return sock.enhancedCache.clear();
  };
  
  return sock;
}

// Exportăm funcționalitățile originale și cele avansate
module.exports = {
  // Funcționalități originale
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  
  // Funcționalități avansate
  makeEnhancedWASocket,
  RateLimiter,
  EnhancedCache,
  WebhookSender,
  ImageProcessor,
  GroupManager
};