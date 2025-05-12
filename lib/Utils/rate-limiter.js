/**
 * Sistem avansat de rate limiting pentru @borutowaileys/library
 * Acest modul gestionează limitarea numărului de cereri pentru a preveni blocarea de către WhatsApp
 */

class RateLimiter {
  /**
   * Creează o nouă instanță de rate limiter
   * @param {Object} options Opțiuni pentru configurare
   * @param {number} options.maxRequests Numărul maxim de cereri într-o fereastră de timp (implicit 10)
   * @param {number} options.timeWindow Fereastra de timp în milisecunde (implicit 60000 - 1 minut)
   */
  constructor(options = {}) {
    this.limits = {};
    this.maxRequests = options.maxRequests || 10;
    this.timeWindow = options.timeWindow || 60000; // 1 minut în ms
  }

  /**
   * Verifică dacă se poate face o cerere pentru un ID specificat
   * @param {string} id Identificatorul unic pentru limitare (exemplu: jid sau chatId)
   * @returns {boolean} True dacă cererea este permisă, false dacă a depășit limita
   */
  canMakeRequest(id) {
    const now = Date.now();
    if (!this.limits[id]) {
      this.limits[id] = { requests: 1, timestamp: now };
      return true;
    }

    const record = this.limits[id];
    if (now - record.timestamp > this.timeWindow) {
      record.requests = 1;
      record.timestamp = now;
      return true;
    }

    if (record.requests < this.maxRequests) {
      record.requests++;
      return true;
    }

    return false;
  }

  /**
   * Obține timpul rămas până când se resetează limita pentru un ID
   * @param {string} id Identificatorul unic
   * @returns {number} Timpul rămas în milisecunde
   */
  getRemainingTime(id) {
    if (!this.limits[id]) return 0;
    const remaining = this.timeWindow - (Date.now() - this.limits[id].timestamp);
    return remaining > 0 ? remaining : 0;
  }

  /**
   * Obține numărul de cereri rămase pentru un ID
   * @param {string} id Identificatorul unic
   * @returns {number} Numărul de cereri rămase
   */
  getRemainingRequests(id) {
    if (!this.limits[id]) return this.maxRequests;
    if (Date.now() - this.limits[id].timestamp > this.timeWindow) return this.maxRequests;
    return this.maxRequests - this.limits[id].requests;
  }

  /**
   * Resetează limitele pentru un ID specific
   * @param {string} id Identificatorul unic de resetat
   */
  resetLimits(id) {
    delete this.limits[id];
  }

  /**
   * Resetează toate limitele
   */
  resetAllLimits() {
    this.limits = {};
  }
}

// Exportăm clasa pentru a fi utilizată în alte module
module.exports = RateLimiter;