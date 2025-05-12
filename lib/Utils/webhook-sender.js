/**
 * Sistem de webhook-uri pentru @borutowaileys/library
 * Acest modul permite integrarea cu alte servicii prin trimiterea de notificări webhook
 */

const axios = require('axios');

class WebhookSender {
  /**
   * Creează o nouă instanță pentru trimiterea de webhook-uri
   * @param {Object} options Opțiuni pentru configurare
   * @param {Array} options.webhooks Lista de webhook-uri inițiale
   * @param {number} options.retryCount Numărul de reîncercări în caz de eșec (implicit 3)
   * @param {number} options.retryDelay Întârzierea între reîncercări în milisecunde (implicit 5000)
   */
  constructor(options = {}) {
    this.webhooks = options.webhooks || [];
    this.retryCount = options.retryCount || 3;
    this.retryDelay = options.retryDelay || 5000; // 5 secunde
  }

  /**
   * Adaugă un webhook nou
   * @param {string} url URL-ul webhook-ului
   * @param {Array} events Lista de evenimente pentru care să se trimită notificări ('*' pentru toate)
   * @param {Object} headers Headere HTTP adiționale
   */
  addWebhook(url, events = ['*'], headers = {}) {
    this.webhooks.push({ url, events, headers });
  }

  /**
   * Elimină un webhook după URL
   * @param {string} url URL-ul webhook-ului de eliminat
   * @returns {boolean} True dacă s-a eliminat, false dacă nu s-a găsit
   */
  removeWebhook(url) {
    const initialLength = this.webhooks.length;
    this.webhooks = this.webhooks.filter(hook => hook.url !== url);
    return initialLength !== this.webhooks.length;
  }

  /**
   * Trimite o notificare webhook către toate webhook-urile înregistrate pentru un eveniment
   * @param {string} event Tipul evenimentului
   * @param {any} data Datele de trimis
   * @returns {Promise<Array>} Rezultatele pentru fiecare webhook
   */
  async send(event, data) {
    const hooks = this.webhooks.filter(hook => 
      hook.events.includes('*') || hook.events.includes(event)
    );

    const payload = {
      event,
      timestamp: Date.now(),
      data
    };

    const promises = hooks.map(hook => this.sendWithRetry(hook.url, payload, hook.headers));
    return Promise.all(promises);
  }

  /**
   * Trimite o notificare webhook cu reîncercări în caz de eșec
   * @param {string} url URL-ul webhook-ului
   * @param {Object} payload Datele de trimis
   * @param {Object} headers Headere HTTP personalizate
   * @param {number} attempt Numărul de încercări efectuate (folosit intern pentru recursivitate)
   * @returns {Promise<Object>} Rezultatul operațiunii
   * @private
   */
  async sendWithRetry(url, payload, headers = {}, attempt = 0) {
    try {
      const response = await axios.post(url, payload, {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'BorutoBaileys-Webhook',
          ...headers
        },
        timeout: 10000 // 10 secunde
      });
      return { 
        success: true, 
        url, 
        statusCode: response.status,
        response: response.data 
      };
    } catch (error) {
      if (attempt < this.retryCount) {
        // Așteptăm înainte de reîncercare
        await new Promise(r => setTimeout(r, this.retryDelay));
        return this.sendWithRetry(url, payload, headers, attempt + 1);
      }
      return { 
        success: false, 
        url, 
        error: error.message,
        statusCode: error.response?.status || 0,
        attempt: attempt + 1
      };
    }
  }

  /**
   * Obține toate webhook-urile configurate
   * @returns {Array} Lista de webhook-uri
   */
  getWebhooks() {
    return [...this.webhooks];
  }
}

// Exportăm clasa pentru a fi utilizată în alte module
module.exports = WebhookSender;