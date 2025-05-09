/**
 * Utility functions for WhatsApp messaging
 * @module utility
 */

/**
 * Create a delay using setTimeout
 * @param {number} ms - Milliseconds to delay
 * @returns {Promise<void>} - Promise that resolves after the delay
 */
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Create a promise with a timeout
 * @param {Promise} promise - The promise to apply timeout to
 * @param {number} timeoutMs - Timeout in milliseconds
 * @param {string} [message='Operation timed out'] - Error message if timeout occurs
 * @returns {Promise} - Promise that rejects if timeout is reached before completion
 */
const promiseTimeout = (promise, timeoutMs, message = 'Operation timed out') => {
    // Create a promise that rejects after timeoutMs milliseconds
    const timeoutPromise = new Promise((_, reject) => {
        const id = setTimeout(() => {
            clearTimeout(id);
            reject(new Error(message));
        }, timeoutMs);
    });

    // Returns a race between our timeout and the passed in promise
    return Promise.race([
        promise,
        timeoutPromise
    ]);
};

/**
 * Retry a function with exponential backoff
 * @param {Function} fn - Function to retry
 * @param {number} [retriesLeft=3] - Number of retries left
 * @param {number} [interval=1000] - Initial interval between retries in milliseconds
 * @param {number} [exponential=2] - Exponential factor for backoff
 * @returns {Promise<any>} - Result of the function call
 */
const retryWithExponentialBackoff = async (fn, retriesLeft = 3, interval = 1000, exponential = 2) => {
    try {
        return await fn();
    } catch (error) {
        if (retriesLeft === 0) {
            throw error;
        }
        
        console.log(`Retrying after ${interval}ms... (${retriesLeft} retries left)`);
        
        await delay(interval);
        
        return retryWithExponentialBackoff(
            fn,
            retriesLeft - 1,
            interval * exponential,
            exponential
        );
    }
};

/**
 * Generate a random integer between min and max (inclusive)
 * @param {number} min - Minimum value
 * @param {number} max - Maximum value
 * @returns {number} - Random integer
 */
const randomInt = (min, max) => {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (max - min + 1)) + min;
};

/**
 * Generate a unique ID
 * @param {number} [length=10] - Length of the ID
 * @returns {string} - Random ID
 */
const generateUniqueId = (length = 10) => {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    
    return result;
};

/**
 * Check if a value is a valid JID (WhatsApp ID)
 * @param {string} jid - The JID to validate
 * @returns {boolean} - True if valid, false otherwise
 */
const isValidJid = (jid) => {
    // Basic JID validation: must end with @s.whatsapp.net or @g.us
    // More comprehensive validation could be added here
    if (typeof jid !== 'string') return false;
    
    return jid.endsWith('@s.whatsapp.net') || jid.endsWith('@g.us') || jid.endsWith('@broadcast');
};

/**
 * Convert a phone number to JID format
 * @param {string} phoneNumber - Phone number
 * @returns {string} - JID format
 */
const phoneNumberToJid = (phoneNumber) => {
    // Remove any non-digit characters
    let number = phoneNumber.replace(/\D/g, '');
    
    // If number starts with 0, replace it with country code (e.g., 62 for Indonesia)
    // This is just an example. Different countries have different rules.
    if (number.startsWith('0')) {
        number = '62' + number.substring(1);
    }
    
    return `${number}@s.whatsapp.net`;
};

/**
 * Extract phone number from JID
 * @param {string} jid - The JID
 * @returns {string|null} - Phone number or null if not valid
 */
const extractPhoneNumber = (jid) => {
    if (!isValidJid(jid)) return null;
    
    // Remove the @s.whatsapp.net or @g.us part
    return jid.split('@')[0];
};

/**
 * Check if a message is from a group
 * @param {string} jid - The JID
 * @returns {boolean} - True if it's a group, false otherwise
 */
const isGroupJid = (jid) => {
    return jid.endsWith('@g.us');
};

/**
 * Format a date object to a user-friendly string
 * @param {Date} date - Date object
 * @returns {string} - Formatted date string
 */
const formatDate = (date) => {
    return date.toLocaleString('en-US', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
};

/**
 * Deep clone an object
 * @param {Object} obj - Object to clone
 * @returns {Object} - Cloned object
 */
const deepClone = (obj) => {
    return JSON.parse(JSON.stringify(obj));
};

/**
 * Check if running on production
 * @returns {boolean} - True if production
 */
const isProduction = () => {
    return process.env.NODE_ENV === 'production';
};

// Export all utility functions
module.exports = {
    delay,
    promiseTimeout,
    retryWithExponentialBackoff,
    randomInt,
    generateUniqueId,
    isValidJid,
    phoneNumberToJid,
    extractPhoneNumber,
    isGroupJid,
    formatDate,
    deepClone,
    isProduction
};