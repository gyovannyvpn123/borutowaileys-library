/**
 * Sistem de procesare a imaginilor pentru @borutowaileys/library
 * Acest modul permite extragerea textului din imagini (OCR) și prelucrarea imaginilor
 */

const Jimp = require('jimp');
// Tesseract.js este importat dinamic pentru a evita încărcarea inutilă când nu este folosit

class ImageProcessor {
  /**
   * Creează o nouă instanță pentru procesarea imaginilor
   * @param {Object} options Opțiuni pentru configurare
   * @param {Array} options.languages Limbile pentru OCR (implicit ['eng'])
   * @param {boolean} options.preprocess Activează preprocesarea pentru îmbunătățirea rezultatelor OCR (implicit true)
   */
  constructor(options = {}) {
    this.langOptions = options.languages || ['eng'];
    this.preprocessEnabled = options.preprocess !== false;
    this.tesseractLoaded = false;
    this.tesseract = null;
  }

  /**
   * Încarcă Tesseract.js în mod lazy 
   * @private
   */
  async _loadTesseract() {
    if (!this.tesseractLoaded) {
      try {
        const Tesseract = await import('tesseract.js');
        this.tesseract = Tesseract.default;
        this.tesseractLoaded = true;
      } catch (error) {
        throw new Error('Nu s-a putut încărca tesseract.js. Asigură-te că este instalat: ' + error.message);
      }
    }
  }

  /**
   * Extrage textul dintr-o imagine
   * @param {Buffer} buffer Buffer-ul imaginii
   * @param {Object} options Opțiuni suplimentare
   * @returns {Promise<string>} Textul extras
   */
  async extractTextFromImage(buffer, options = {}) {
    await this._loadTesseract();
    
    let imageBuffer = buffer;
    
    if (this.preprocessEnabled && !options.skipPreprocess) {
      imageBuffer = await this.preprocess(buffer, options.preprocessOptions);
    }
    
    const result = await this.tesseract.recognize(
      imageBuffer, 
      options.languages || this.langOptions.join('+'),
      { 
        logger: options.logger || (m => console.log(m))
      }
    );
    
    return result.data.text;
  }

  /**
   * Preprocesează o imagine pentru îmbunătățirea rezultatelor OCR
   * @param {Buffer} buffer Buffer-ul imaginii
   * @param {Object} options Opțiuni de preprocesare
   * @returns {Promise<Buffer>} Buffer-ul imaginii procesate
   */
  async preprocess(buffer, options = {}) {
    try {
      const image = await Jimp.read(buffer);
      
      // Aplicăm transformările de bază pentru OCR
      image.grayscale();
      
      // Ajustăm contrastul dacă este specificat
      const contrast = options.contrast || 0.2;
      if (contrast !== 0) {
        image.contrast(contrast);
      }
      
      // Normalizează imaginea pentru distribuție uniformă a luminozității
      image.normalize();
      
      // Scaling opțional pentru îmbunătățirea OCR
      if (options.scale) {
        image.scale(options.scale);
      }
      
      // Opțional, putem aplica un threshold pentru text mai clar pe fundal deschis
      if (options.threshold) {
        image.threshold({ max: options.threshold });
      }
        
      return await image.getBufferAsync(Jimp.AUTO);
    } catch (error) {
      console.error('Eroare la preprocesarea imaginii:', error);
      return buffer; // Returnăm imaginea originală în caz de eroare
    }
  }

  /**
   * Redimensionează o imagine la dimensiunile specificate
   * @param {Buffer} buffer Buffer-ul imaginii
   * @param {number} width Lățimea dorită
   * @param {number} height Înălțimea dorită
   * @returns {Promise<Buffer>} Buffer-ul imaginii redimensionate
   */
  async resizeImage(buffer, width, height) {
    try {
      const image = await Jimp.read(buffer);
      image.resize(width, height);
      return await image.getBufferAsync(Jimp.AUTO);
    } catch (error) {
      console.error('Eroare la redimensionarea imaginii:', error);
      return buffer;
    }
  }

  /**
   * Comprimă o imagine pentru a reduce dimensiunea
   * @param {Buffer} buffer Buffer-ul imaginii
   * @param {number} quality Calitatea (0-100, implicit 80)
   * @returns {Promise<Buffer>} Buffer-ul imaginii comprimate
   */
  async compressImage(buffer, quality = 80) {
    try {
      const image = await Jimp.read(buffer);
      image.quality(quality);
      return await image.getBufferAsync(Jimp.AUTO);
    } catch (error) {
      console.error('Eroare la comprimarea imaginii:', error);
      return buffer;
    }
  }

  /**
   * Adaugă un watermark unei imagini
   * @param {Buffer} imageBuffer Buffer-ul imaginii principale
   * @param {Buffer|string} watermarkBuffer Buffer-ul watermark-ului sau o cale de fișier
   * @param {Object} options Opțiuni pentru watermark
   * @returns {Promise<Buffer>} Buffer-ul imaginii cu watermark
   */
  async addWatermark(imageBuffer, watermarkBuffer, options = {}) {
    try {
      const image = await Jimp.read(imageBuffer);
      const watermark = await Jimp.read(watermarkBuffer);
      
      // Setăm opacitatea watermark-ului
      watermark.opacity(options.opacity || 0.5);
      
      // Poziționăm watermark-ul
      const x = options.x || 0;
      const y = options.y || 0;
      
      // Aplicăm watermark-ul
      image.composite(watermark, x, y, {
        mode: Jimp.BLEND_SOURCE_OVER,
        opacityDest: 1,
        opacitySource: options.opacity || 0.5
      });
      
      return await image.getBufferAsync(Jimp.AUTO);
    } catch (error) {
      console.error('Eroare la adăugarea watermark-ului:', error);
      return imageBuffer;
    }
  }

  /**
   * Recunoaște obiecte în imagine (placeholder pentru integrări viitoare)
   * @param {Buffer} buffer Buffer-ul imaginii
   * @returns {Promise<Object>} Rezultatele detectării de obiecte
   */
  async detectObjects(buffer) {
    // Placeholder pentru viitoare integrări cu TensorFlow sau alt API de computer vision
    return { message: "Object detection coming soon" };
  }
}

// Exportăm clasa pentru a fi utilizată în alte module
module.exports = ImageProcessor;