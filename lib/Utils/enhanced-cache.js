/**
 * Sistem de cache îmbunătățit pentru @borutowaileys/library
 * Acest modul oferă funcționalități avansate de cache, inclusiv persistență și TTL configurabil
 */

const fs = require('fs');
const NodeCache = require('@cacheable/node-cache');

class EnhancedCache {
  /**
   * Creează o nouă instanță de cache îmbunătățit
   * @param {Object} options Opțiuni pentru configurare
   * @param {number} options.ttl Timpul de viață în secunde (implicit 3600 - 1 oră)
   * @param {number} options.checkPeriod Perioada de verificare în secunde (implicit 120 - 2 minute)
   * @param {boolean} options.persistence Activează persistența pe disc (implicit false)
   * @param {string} options.persistencePath Calea fișierului pentru persistență (implicit './cache-data.json')
   */
  constructor(options = {}) {
    this.cache = new NodeCache({
      stdTTL: options.ttl || 3600, // 1 oră în secunde
      checkperiod: options.checkPeriod || 120, // 2 minute în secunde
      useClones: false
    });
    
    this.persistenceEnabled = options.persistence || false;
    this.persistencePath = options.persistencePath || './cache-data.json';
    if (this.persistenceEnabled) {
      this.setupPersistence();
    }
  }

  /**
   * Configurează persistența cache-ului
   * @private
   */
  setupPersistence() {
    // Salvare cache la interval regulat
    this.persistenceInterval = setInterval(() => {
      this.saveToFile();
    }, 300000); // 5 minute
    
    // Salvare cache la închiderea aplicației
    process.on('SIGINT', () => {
      this.saveToFile();
      clearInterval(this.persistenceInterval);
      process.exit(0);
    });
    
    // Încărcare cache din fișier la pornire
    this.loadFromFile();
  }

  /**
   * Salvează cache-ul în fișier
   * @returns {boolean} Succesul operațiunii
   */
  saveToFile() {
    try {
      const data = JSON.stringify(this.cache.mget(this.cache.keys()));
      fs.writeFileSync(this.persistencePath, data);
      return true;
    } catch (error) {
      console.error('Eroare la salvarea cache-ului:', error);
      return false;
    }
  }

  /**
   * Încarcă cache-ul din fișier
   * @returns {boolean} Succesul operațiunii
   */
  loadFromFile() {
    try {
      if (fs.existsSync(this.persistencePath)) {
        const data = JSON.parse(fs.readFileSync(this.persistencePath, 'utf8'));
        Object.entries(data).forEach(([key, value]) => {
          this.cache.set(key, value);
        });
        return true;
      }
      return false;
    } catch (error) {
      console.error('Eroare la încărcarea cache-ului:', error);
      return false;
    }
  }

  /**
   * Adaugă o valoare în cache
   * @param {string} key Cheia
   * @param {any} value Valoarea
   * @param {number} ttl Timpul de viață în secunde (opțional)
   * @returns {boolean} Succesul operațiunii
   */
  set(key, value, ttl) {
    return this.cache.set(key, value, ttl);
  }

  /**
   * Obține o valoare din cache
   * @param {string} key Cheia
   * @returns {any} Valoarea sau undefined dacă nu există
   */
  get(key) {
    return this.cache.get(key);
  }

  /**
   * Verifică dacă o cheie există în cache
   * @param {string} key Cheia
   * @returns {boolean} True dacă există, false altfel
   */
  has(key) {
    return this.cache.has(key);
  }

  /**
   * Șterge o valoare din cache
   * @param {string} key Cheia
   * @returns {number} Numărul de elemente șterse
   */
  delete(key) {
    return this.cache.del(key);
  }

  /**
   * Golește tot cache-ul
   * @returns {void}
   */
  clear() {
    return this.cache.flushAll();
  }

  /**
   * Obține toate cheile din cache
   * @returns {string[]} Array cu toate cheile
   */
  keys() {
    return this.cache.keys();
  }

  /**
   * Obține statistici despre utilizarea cache-ului
   * @returns {Object} Statistici
   */
  getStats() {
    return this.cache.getStats();
  }
}

// Exportăm clasa pentru a fi utilizată în alte module
module.exports = EnhancedCache;