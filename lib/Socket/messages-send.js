/**
 * Enhanced WhatsApp Message Sending Functionality
 * @module messages-send
 * @description Improved implementation for sending WhatsApp messages with robust error handling, 
 * message formatting options, better performance optimization, and advanced features.
 * @version 2.1.0
 */

const { 
    delay, 
    promiseTimeout, 
    retryWithExponentialBackoff, 
    isValidJid, 
    phoneNumberToJid 
} = require('../Helper/utility');
const { proto } = require('@whiskeysockets/baileys');
const { generateWAMessageFromContent } = require('@whiskeysockets/baileys');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
// Use https module instead of node-fetch for URL content
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const logger = require('pino')({ 
    level: process.env.DEBUG_LEVEL || 'silent'
});

/**
 * @typedef {Object} MessageOptions
 * @property {boolean} [quoted=false] - Whether to quote a message
 * @property {Object} [quotedMessage=null] - The message to quote
 * @property {boolean} [mentions=true] - Whether to include mentions
 * @property {Array<string>} [mentionedJid=[]] - JIDs to mention
 * @property {Object} [contextInfo={}] - Additional context info
 * @property {boolean} [linkPreview=true] - Whether to include link previews
 * @property {boolean} [detectLinks=true] - Whether to detect links in the message
 * @property {number} [priority=0] - Message priority (0-5, 0 being highest)
 * @property {number} [retryCount=3] - Number of retries for failed messages
 * @property {number} [retryDelay=2000] - Delay between retries in ms
 * @property {boolean} [silent=false] - Send without notification
 * @property {boolean} [viewOnce=false] - Send as view-once message
 * @property {number} [timeout=60000] - Timeout for message sending in ms
 * @property {boolean} [receipts=true] - Request read receipts
 * @property {Object} [formatting] - Text formatting options
 * @property {boolean} [formatting.bold=false] - Make text bold
 * @property {boolean} [formatting.italic=false] - Make text italic
 * @property {boolean} [formatting.monospace=false] - Use monospace font
 * @property {boolean} [formatting.strikethrough=false] - Use strikethrough
 * @property {string} [formatting.color] - Text color (limited support)
 */

/**
 * Enhanced send text message function with improved error handling and performance
 * 
 * @param {Object} sock - The socket connection
 * @param {string} jid - The JID to send the message to
 * @param {string} text - The message text
 * @param {MessageOptions} options - Message sending options
 * @returns {Promise<Object>} - The message info
 */
async function sendText(sock, jid, text, options = {}) {
    // Validate JID early to avoid unnecessary processing
    if (!jid || (typeof jid !== 'string')) {
        throw new Error('Invalid JID: must be a non-empty string');
    }
    
    // Check if text is valid
    if (text === undefined || text === null) {
        throw new Error('Message text cannot be null or undefined');
    }
    
    // Convert to string if not already
    if (typeof text !== 'string') {
        text = String(text);
    }
    
    try {
        // Convert phone number to JID format if needed
        if (!jid.includes('@')) {
            jid = phoneNumberToJid(jid);
        }
        
        // Apply text formatting if needed
        const formattedText = applyFormatting(text, options.formatting || {});
        
        // Build message options
        const messageOptions = buildMessageOptions(options);
        
        // Configure retry mechanism
        const retryCount = options.retryCount || 3;
        const retryDelay = options.retryDelay || 2000;
        
        // Attempt to send with retry logic
        return await sendWithRetry(
            async () => {
                return await sock.sendMessage(
                    jid, 
                    { text: formattedText },
                    messageOptions
                );
            },
            retryCount,
            retryDelay
        );
    } catch (error) {
        // Enhanced error logging with more details
        logger.error({
            message: `Error sending text message`,
            error: error.message,
            jid,
            textLength: text?.length,
            options: JSON.stringify(options)
        });
        
        throw new Error(`Failed to send text message: ${error.message}`);
    }
}

/**
 * Enhanced send image message function
 * 
 * @param {Object} sock - The socket connection
 * @param {string} jid - The JID to send the message to
 * @param {string|Buffer} content - Image content (URL, path, or buffer)
 * @param {string} caption - Image caption
 * @param {MessageOptions} options - Message sending options
 * @returns {Promise<Object>} - The message info
 */
async function sendImage(sock, jid, content, caption = '', options = {}) {
    try {
        // Format caption if needed
        const formattedCaption = applyFormatting(caption, options.formatting || {});
        
        // Build message options
        const messageOptions = buildMessageOptions(options);
        
        // Configure retry mechanism
        const retryCount = options.retryCount || 3;
        const retryDelay = options.retryDelay || 2000;
        
        // Process content (determine if it's URL, path, or buffer)
        const imageContent = await processMediaContent(content);
        
        // Attempt to send with retry logic
        return await sendWithRetry(
            async () => {
                return await sock.sendMessage(
                    jid, 
                    { 
                        image: imageContent,
                        caption: formattedCaption,
                        jpegThumbnail: options.thumbnail || undefined
                    },
                    messageOptions
                );
            },
            retryCount,
            retryDelay
        );
    } catch (error) {
        logger.error(`Error sending image message: ${error.message}`);
        throw new Error(`Failed to send image message: ${error.message}`);
    }
}

/**
 * Enhanced send video message function
 * 
 * @param {Object} sock - The socket connection
 * @param {string} jid - The JID to send the message to
 * @param {string|Buffer} content - Video content (URL, path, or buffer)
 * @param {string} caption - Video caption
 * @param {MessageOptions} options - Message sending options
 * @returns {Promise<Object>} - The message info
 */
async function sendVideo(sock, jid, content, caption = '', options = {}) {
    try {
        // Format caption if needed
        const formattedCaption = applyFormatting(caption, options.formatting || {});
        
        // Build message options
        const messageOptions = buildMessageOptions(options);
        
        // Configure retry mechanism
        const retryCount = options.retryCount || 3;
        const retryDelay = options.retryDelay || 2000;
        
        // Process content (determine if it's URL, path, or buffer)
        const videoContent = await processMediaContent(content);
        
        // Attempt to send with retry logic
        return await sendWithRetry(
            async () => {
                return await sock.sendMessage(
                    jid, 
                    { 
                        video: videoContent,
                        caption: formattedCaption,
                        gifPlayback: options.gifPlayback || false,
                        jpegThumbnail: options.thumbnail || undefined
                    },
                    messageOptions
                );
            },
            retryCount,
            retryDelay
        );
    } catch (error) {
        logger.error(`Error sending video message: ${error.message}`);
        throw new Error(`Failed to send video message: ${error.message}`);
    }
}

/**
 * Enhanced send audio message function
 * 
 * @param {Object} sock - The socket connection
 * @param {string} jid - The JID to send the message to
 * @param {string|Buffer} content - Audio content (URL, path, or buffer)
 * @param {boolean} ptt - Push to talk (voice note) format
 * @param {MessageOptions} options - Message sending options
 * @returns {Promise<Object>} - The message info
 */
async function sendAudio(sock, jid, content, ptt = false, options = {}) {
    try {
        // Build message options
        const messageOptions = buildMessageOptions(options);
        
        // Configure retry mechanism
        const retryCount = options.retryCount || 3;
        const retryDelay = options.retryDelay || 2000;
        
        // Process content (determine if it's URL, path, or buffer)
        const audioContent = await processMediaContent(content);
        
        // Attempt to send with retry logic
        return await sendWithRetry(
            async () => {
                return await sock.sendMessage(
                    jid, 
                    { 
                        audio: audioContent,
                        mimetype: 'audio/mp4',
                        ptt: ptt
                    },
                    messageOptions
                );
            },
            retryCount,
            retryDelay
        );
    } catch (error) {
        logger.error(`Error sending audio message: ${error.message}`);
        throw new Error(`Failed to send audio message: ${error.message}`);
    }
}

/**
 * Enhanced send document message function
 * 
 * @param {Object} sock - The socket connection
 * @param {string} jid - The JID to send the message to
 * @param {string|Buffer} content - Document content (URL, path, or buffer)
 * @param {string} filename - Document filename
 * @param {string} mimetype - Document mimetype
 * @param {MessageOptions} options - Message sending options
 * @returns {Promise<Object>} - The message info
 */
async function sendDocument(sock, jid, content, filename, mimetype = 'application/octet-stream', options = {}) {
    try {
        // Build message options
        const messageOptions = buildMessageOptions(options);
        
        // Configure retry mechanism
        const retryCount = options.retryCount || 3;
        const retryDelay = options.retryDelay || 2000;
        
        // Process content (determine if it's URL, path, or buffer)
        const documentContent = await processMediaContent(content);
        
        // Attempt to send with retry logic
        return await sendWithRetry(
            async () => {
                return await sock.sendMessage(
                    jid, 
                    { 
                        document: documentContent,
                        mimetype: mimetype,
                        fileName: filename
                    },
                    messageOptions
                );
            },
            retryCount,
            retryDelay
        );
    } catch (error) {
        logger.error(`Error sending document message: ${error.message}`);
        throw new Error(`Failed to send document message: ${error.message}`);
    }
}

/**
 * Send contact information
 * 
 * @param {Object} sock - The socket connection
 * @param {string} jid - The JID to send the message to
 * @param {Array<Object>} contacts - Array of contact objects
 * @param {MessageOptions} options - Message sending options
 * @returns {Promise<Object>} - The message info
 */
async function sendContact(sock, jid, contacts, options = {}) {
    try {
        // Build message options
        const messageOptions = buildMessageOptions(options);
        
        // Configure retry mechanism
        const retryCount = options.retryCount || 3;
        const retryDelay = options.retryDelay || 2000;
        
        // Process contacts to proper format
        const formattedContacts = contacts.map(contact => ({
            displayName: contact.name || 'Contact',
            vcard: generateVCard(contact)
        }));
        
        // Attempt to send with retry logic
        return await sendWithRetry(
            async () => {
                return await sock.sendMessage(
                    jid, 
                    { 
                        contacts: {
                            displayName: `${formattedContacts.length} contact${formattedContacts.length > 1 ? 's' : ''}`,
                            contacts: formattedContacts
                        }
                    },
                    messageOptions
                );
            },
            retryCount,
            retryDelay
        );
    } catch (error) {
        logger.error(`Error sending contact message: ${error.message}`);
        throw new Error(`Failed to send contact message: ${error.message}`);
    }
}

/**
 * Send location information
 * 
 * @param {Object} sock - The socket connection
 * @param {string} jid - The JID to send the message to
 * @param {Object} locationInfo - Location information object
 * @param {MessageOptions} options - Message sending options
 * @returns {Promise<Object>} - The message info
 */
async function sendLocation(sock, jid, locationInfo, options = {}) {
    try {
        // Build message options
        const messageOptions = buildMessageOptions(options);
        
        // Configure retry mechanism
        const retryCount = options.retryCount || 3;
        const retryDelay = options.retryDelay || 2000;
        
        // Attempt to send with retry logic
        return await sendWithRetry(
            async () => {
                return await sock.sendMessage(
                    jid, 
                    { 
                        location: {
                            degreesLatitude: locationInfo.latitude,
                            degreesLongitude: locationInfo.longitude,
                            name: locationInfo.name || '',
                            address: locationInfo.address || ''
                        }
                    },
                    messageOptions
                );
            },
            retryCount,
            retryDelay
        );
    } catch (error) {
        logger.error(`Error sending location message: ${error.message}`);
        throw new Error(`Failed to send location message: ${error.message}`);
    }
}

/**
 * Send list message (interactive menu)
 * 
 * @param {Object} sock - The socket connection
 * @param {string} jid - The JID to send the message to
 * @param {Object} listInfo - List information object
 * @param {MessageOptions} options - Message sending options
 * @returns {Promise<Object>} - The message info
 */
async function sendListMessage(sock, jid, listInfo, options = {}) {
    try {
        // Build message options
        const messageOptions = buildMessageOptions(options);
        
        // Configure retry mechanism
        const retryCount = options.retryCount || 3;
        const retryDelay = options.retryDelay || 2000;
        
        // Validate list structure
        if (!listInfo.title || !listInfo.text || !Array.isArray(listInfo.sections)) {
            throw new Error('Invalid list structure, must include title, text, and sections array');
        }
        
        // Attempt to send with retry logic
        return await sendWithRetry(
            async () => {
                return await sock.sendMessage(
                    jid, 
                    {
                        text: listInfo.text,
                        footer: listInfo.footer || '',
                        title: listInfo.title,
                        buttonText: listInfo.buttonText || 'Select an option',
                        sections: listInfo.sections
                    },
                    messageOptions
                );
            },
            retryCount,
            retryDelay
        );
    } catch (error) {
        logger.error(`Error sending list message: ${error.message}`);
        throw new Error(`Failed to send list message: ${error.message}`);
    }
}

/**
 * Send template/button message
 * 
 * @param {Object} sock - The socket connection
 * @param {string} jid - The JID to send the message to
 * @param {Object} templateInfo - Template information object
 * @param {MessageOptions} options - Message sending options
 * @returns {Promise<Object>} - The message info
 */
async function sendTemplate(sock, jid, templateInfo, options = {}) {
    try {
        // Build message options
        const messageOptions = buildMessageOptions(options);
        
        // Configure retry mechanism
        const retryCount = options.retryCount || 3;
        const retryDelay = options.retryDelay || 2000;
        
        // Validate template structure
        if (!templateInfo.text || !Array.isArray(templateInfo.buttons)) {
            throw new Error('Invalid template structure, must include text and buttons array');
        }
        
        // Build template message
        const templateMessage = {
            text: templateInfo.text,
            footer: templateInfo.footer || '',
            templateButtons: templateInfo.buttons
        };
        
        // Attempt to send with retry logic
        return await sendWithRetry(
            async () => {
                return await sock.sendMessage(jid, templateMessage, messageOptions);
            },
            retryCount,
            retryDelay
        );
    } catch (error) {
        logger.error(`Error sending template message: ${error.message}`);
        throw new Error(`Failed to send template message: ${error.message}`);
    }
}

/**
 * Send a reaction to a message
 * 
 * @param {Object} sock - The socket connection
 * @param {string} jid - The JID to send the reaction to
 * @param {Object} messageKey - The key of the message to react to
 * @param {string} emoji - The emoji to react with
 * @returns {Promise<Object>} - The result
 */
async function sendReaction(sock, jid, messageKey, emoji) {
    try {
        return await sock.sendMessage(
            jid,
            {
                react: {
                    text: emoji,
                    key: messageKey
                }
            }
        );
    } catch (error) {
        logger.error(`Error sending reaction: ${error.message}`);
        throw new Error(`Failed to send reaction: ${error.message}`);
    }
}

/**
 * Send message with rich preview (link)
 * 
 * @param {Object} sock - The socket connection
 * @param {string} jid - The JID to send the message to
 * @param {string} text - Message text with link
 * @param {Object} previewInfo - Preview information
 * @param {MessageOptions} options - Message sending options
 * @returns {Promise<Object>} - The message info
 */
async function sendWithLinkPreview(sock, jid, text, previewInfo = {}, options = {}) {
    try {
        // Apply text formatting if needed
        const formattedText = applyFormatting(text, options.formatting || {});
        
        // Build message options
        const messageOptions = buildMessageOptions(options);
        
        // Configure retry mechanism
        const retryCount = options.retryCount || 3;
        const retryDelay = options.retryDelay || 2000;
        
        // Create message with link preview
        const message = {
            text: formattedText,
            contextInfo: {
                externalAdReply: {
                    title: previewInfo.title || '',
                    body: previewInfo.description || '',
                    mediaType: previewInfo.mediaType || 1,
                    thumbnailUrl: previewInfo.thumbnailUrl || '',
                    sourceUrl: previewInfo.sourceUrl || '',
                }
            }
        };
        
        // Attempt to send with retry logic
        return await sendWithRetry(
            async () => {
                return await sock.sendMessage(jid, message, messageOptions);
            },
            retryCount,
            retryDelay
        );
    } catch (error) {
        logger.error(`Error sending message with link preview: ${error.message}`);
        throw new Error(`Failed to send message with link preview: ${error.message}`);
    }
}

/**
 * Send a batch of messages efficiently
 * 
 * @param {Object} sock - The socket connection 
 * @param {Array<Object>} messages - Array of message objects
 * @param {number} delayBetweenMs - Delay between messages in ms
 * @returns {Promise<Array<Object>>} - Array of message results
 */
async function sendBatch(sock, messages, delayBetweenMs = 1000) {
    try {
        const results = [];
        
        for (const msg of messages) {
            try {
                let result;
                
                // Determine message type and use appropriate send function
                switch (msg.type) {
                    case 'text':
                        result = await sendText(sock, msg.jid, msg.content, msg.options);
                        break;
                    case 'image':
                        result = await sendImage(sock, msg.jid, msg.content, msg.caption, msg.options);
                        break;
                    case 'video':
                        result = await sendVideo(sock, msg.jid, msg.content, msg.caption, msg.options);
                        break;
                    case 'audio':
                        result = await sendAudio(sock, msg.jid, msg.content, msg.ptt, msg.options);
                        break;
                    case 'document':
                        result = await sendDocument(sock, msg.jid, msg.content, msg.filename, msg.mimetype, msg.options);
                        break;
                    case 'contact':
                        result = await sendContact(sock, msg.jid, msg.contacts, msg.options);
                        break;
                    case 'location':
                        result = await sendLocation(sock, msg.jid, msg.locationInfo, msg.options);
                        break;
                    case 'template':
                        result = await sendTemplate(sock, msg.jid, msg.templateInfo, msg.options);
                        break;
                    case 'list':
                        result = await sendListMessage(sock, msg.jid, msg.listInfo, msg.options);
                        break;
                    default:
                        throw new Error(`Unknown message type: ${msg.type}`);
                }
                
                results.push({ success: true, result, message: msg });
                
                // Delay between messages to avoid rate limiting
                if (delayBetweenMs > 0 && messages.indexOf(msg) < messages.length - 1) {
                    await delay(delayBetweenMs);
                }
            } catch (err) {
                results.push({ success: false, error: err.message, message: msg });
                // Continue with next message even if this one failed
            }
        }
        
        return results;
    } catch (error) {
        logger.error(`Error sending batch messages: ${error.message}`);
        throw new Error(`Failed to send batch messages: ${error.message}`);
    }
}

/**
 * Send message to multiple recipients (broadcast)
 * 
 * @param {Object} sock - The socket connection
 * @param {Array<string>} jids - Array of JIDs to send to
 * @param {Object} messageContent - The message content object
 * @param {MessageOptions} options - Message sending options
 * @returns {Promise<Object>} - Results object
 */
async function broadcast(sock, jids, messageContent, options = {}) {
    try {
        const results = {
            total: jids.length,
            successful: 0,
            failed: 0,
            errors: []
        };
        
        // Configure retry and delay options
        const retryCount = options.retryCount || 3;
        const retryDelay = options.retryDelay || 2000;
        const delayBetween = options.delayBetween || 1000;
        
        // Process each JID
        for (const jid of jids) {
            try {
                // Determine message type and send accordingly
                if (messageContent.text) {
                    await sendText(sock, jid, messageContent.text, options);
                } else if (messageContent.image) {
                    await sendImage(sock, jid, messageContent.image, messageContent.caption || '', options);
                } else if (messageContent.video) {
                    await sendVideo(sock, jid, messageContent.video, messageContent.caption || '', options);
                } else if (messageContent.audio) {
                    await sendAudio(sock, jid, messageContent.audio, messageContent.ptt || false, options);
                } else if (messageContent.document) {
                    await sendDocument(
                        sock, 
                        jid, 
                        messageContent.document, 
                        messageContent.filename || 'file', 
                        messageContent.mimetype, 
                        options
                    );
                } else if (messageContent.location) {
                    await sendLocation(sock, jid, messageContent.location, options);
                } else if (messageContent.contacts) {
                    await sendContact(sock, jid, messageContent.contacts, options);
                } else if (messageContent.template) {
                    await sendTemplate(sock, jid, messageContent.template, options);
                } else if (messageContent.list) {
                    await sendListMessage(sock, jid, messageContent.list, options);
                } else {
                    throw new Error('No valid message content provided');
                }
                
                results.successful++;
                
                // Add delay between messages
                if (delayBetween > 0 && jids.indexOf(jid) < jids.length - 1) {
                    await delay(delayBetween);
                }
            } catch (error) {
                results.failed++;
                results.errors.push({
                    jid,
                    error: error.message
                });
            }
        }
        
        return results;
    } catch (error) {
        logger.error(`Error broadcasting messages: ${error.message}`);
        throw new Error(`Failed to broadcast messages: ${error.message}`);
    }
}

/**
 * Delete a message for everyone
 * 
 * @param {Object} sock - The socket connection
 * @param {string} jid - The JID where the message is
 * @param {Object} key - The message key to delete
 * @returns {Promise<Object>} - Result object
 */
async function deleteMessage(sock, jid, key) {
    try {
        return await sock.sendMessage(jid, { delete: key });
    } catch (error) {
        logger.error(`Error deleting message: ${error.message}`);
        throw new Error(`Failed to delete message: ${error.message}`);
    }
}

/**
 * Update a message (edit)
 * 
 * @param {Object} sock - The socket connection
 * @param {string} jid - The JID where the message is
 * @param {string} text - New message text
 * @param {Object} key - The message key to edit
 * @param {MessageOptions} options - Message options
 * @returns {Promise<Object>} - Result object
 */
async function updateMessage(sock, jid, text, key, options = {}) {
    try {
        // Apply text formatting if needed
        const formattedText = applyFormatting(text, options.formatting || {});
        
        // Build message options
        const messageOptions = buildMessageOptions(options);
        
        return await sock.sendMessage(
            jid, 
            { text: formattedText, edit: key },
            messageOptions
        );
    } catch (error) {
        logger.error(`Error updating message: ${error.message}`);
        throw new Error(`Failed to update message: ${error.message}`);
    }
}

/**
 * Send a poll message
 * 
 * @param {Object} sock - The socket connection
 * @param {string} jid - The JID to send to
 * @param {Object} pollData - Poll data object
 * @param {MessageOptions} options - Message options
 * @returns {Promise<Object>} - Result object
 */
async function sendPoll(sock, jid, pollData, options = {}) {
    try {
        // Build message options
        const messageOptions = buildMessageOptions(options);
        
        // Configure retry mechanism
        const retryCount = options.retryCount || 3;
        const retryDelay = options.retryDelay || 2000;
        
        // Validate poll structure
        if (!pollData.name || !Array.isArray(pollData.options) || pollData.options.length < 2) {
            throw new Error('Invalid poll structure, must include name and at least 2 options');
        }
        
        // Attempt to send with retry logic
        return await sendWithRetry(
            async () => {
                return await sock.sendMessage(
                    jid, 
                    {
                        poll: {
                            name: pollData.name,
                            options: pollData.options,
                            selectableCount: pollData.selectableCount || 1
                        }
                    },
                    messageOptions
                );
            },
            retryCount,
            retryDelay
        );
    } catch (error) {
        logger.error(`Error sending poll message: ${error.message}`);
        throw new Error(`Failed to send poll message: ${error.message}`);
    }
}

/**
 * Send raw WhatsApp protocol message
 * 
 * @param {Object} sock - The socket connection
 * @param {string} jid - The JID to send to
 * @param {Object} content - Raw message content
 * @param {Object} options - Message options
 * @returns {Promise<Object>} - Result object
 */
async function sendRaw(sock, jid, content, options = {}) {
    try {
        // Build message options
        const messageOptions = buildMessageOptions(options);
        
        // Configure retry mechanism
        const retryCount = options.retryCount || 3;
        const retryDelay = options.retryDelay || 2000;
        
        // Generate WA message from content
        const waMessage = generateWAMessageFromContent(jid, content, messageOptions);
        
        // Attempt to send with retry logic
        return await sendWithRetry(
            async () => {
                return await sock.relayMessage(
                    jid,
                    waMessage.message,
                    { messageId: waMessage.key.id }
                );
            },
            retryCount,
            retryDelay
        );
    } catch (error) {
        logger.error(`Error sending raw message: ${error.message}`);
        throw new Error(`Failed to send raw message: ${error.message}`);
    }
}

/**
 * Apply enhanced formatting to text
 * 
 * @param {string} text - Text to format
 * @param {Object} formatting - Formatting options
 * @returns {string} - Formatted text
 */
function applyFormatting(text, formatting = {}) {
    // Guard against null or undefined text
    if (!text) return '';
    
    let formattedText = text;
    
    // Apply all formatting in proper order
    if (formatting.bold) {
        formattedText = `*${formattedText}*`;
    }
    
    if (formatting.italic) {
        formattedText = `_${formattedText}_`;
    }
    
    if (formatting.strikethrough) {
        formattedText = `~${formattedText}~`;
    }
    
    // Monospace should be applied last as it wraps the entire text
    if (formatting.monospace) {
        formattedText = "```" + formattedText + "```";
    }
    
    // Apply color codes (limited WhatsApp support)
    if (formatting.color) {
        try {
            // Limited colors supported in WhatsApp
            const supportedColors = {
                red: '#FF0000',
                blue: '#0000FF',
                green: '#00FF00',
                yellow: '#FFFF00',
                orange: '#FFA500',
                purple: '#800080',
                black: '#000000',
                white: '#FFFFFF',
            };
            
            const colorCode = supportedColors[formatting.color.toLowerCase()] || formatting.color;
            
            // Text with color formatting using CSS-like markdown (some clients may support this)
            formattedText = `<font color="${colorCode}">${formattedText}</font>`;
        } catch (e) {
            // If color formatting fails, just return the text with other formatting
            logger.debug('Color formatting skipped:', e.message);
        }
    }
    
    return formattedText;
}

/**
 * Build message options object with enhanced options
 * 
 * @param {MessageOptions} options - User options
 * @returns {Object} - Formatted options for Baileys
 */
function buildMessageOptions(options = {}) {
    const messageOptions = {};
    
    // Add quoted message if exists
    if (options.quoted) {
        messageOptions.quoted = options.quotedMessage;
    }
    
    // Add mentions if enabled
    if (options.mentions !== false && Array.isArray(options.mentionedJid) && options.mentionedJid.length > 0) {
        messageOptions.mentions = options.mentionedJid;
    }
    
    // Add context info if provided
    if (options.contextInfo && typeof options.contextInfo === 'object') {
        messageOptions.contextInfo = options.contextInfo;
    }
    
    // Set message as silent if needed
    if (options.silent) {
        messageOptions.silent = true;
    }
    
    // Set view once mode if requested
    if (options.viewOnce) {
        messageOptions.viewOnce = true;
    }
    
    // Set if read receipts are requested
    if (options.receipts === false) {
        messageOptions.ephemeralExpiration = 0;
    }
    
    // Add timeout for sending
    if (typeof options.timeout === 'number' && options.timeout > 0) {
        messageOptions.timeout = options.timeout;
    }
    
    return messageOptions;
}

/**
 * Process media content with improved handling
 * 
 * @param {string|Buffer} content - Content to process
 * @returns {Promise<Buffer|Object>} - Processed content
 */
async function processMediaContent(content) {
    // If content is already a Buffer, return as is
    if (Buffer.isBuffer(content)) {
        return content;
    }
    
    // If content is a string, check if it's a URL
    if (typeof content === 'string') {
        if (content.startsWith('http://') || content.startsWith('https://')) {
            // For direct URL use in Baileys
            return { url: content };
        } else {
            // Assume it's a file path, try to read it
            try {
                const filePath = path.resolve(content);
                if (!fs.existsSync(filePath)) {
                    throw new Error(`File not found: ${filePath}`);
                }
                
                // Read file in a non-blocking way
                return await new Promise((resolve, reject) => {
                    fs.readFile(filePath, (err, data) => {
                        if (err) reject(new Error(`Error reading file: ${err.message}`));
                        else resolve(data);
                    });
                });
            } catch (error) {
                logger.error(`Error processing file at path ${content}: ${error.message}`);
                throw new Error(`Failed to process file at path ${content}: ${error.message}`);
            }
        }
    }
    
    throw new Error('Invalid content type, must be URL, file path, or Buffer');
}

/**
 * Send with retry mechanism and exponential backoff
 * 
 * @param {Function} sendFunction - Function to execute
 * @param {number} maxRetries - Maximum number of retries
 * @param {number} initialDelayMs - Initial delay between retries in ms
 * @returns {Promise<any>} - Result from the send function
 */
async function sendWithRetry(sendFunction, maxRetries = 3, initialDelayMs = 2000) {
    // Use the utility function for exponential backoff
    try {
        return await retryWithExponentialBackoff(
            sendFunction,
            maxRetries,
            initialDelayMs
        );
    } catch (error) {
        // Log the error with more details
        logger.error({
            msg: 'Failed to send message after maximum retries',
            error: error.message,
            stack: error.stack,
            retries: maxRetries
        });
        
        // Rethrow with clear message
        throw new Error(`Failed to send message after ${maxRetries} retries: ${error.message}`);
    }
}

/**
 * Generate vCard for contact sharing
 * 
 * @param {Object} contact - Contact information
 * @returns {string} - vCard string
 */
function generateVCard(contact) {
    let vcard = 'BEGIN:VCARD\n';
    vcard += 'VERSION:3.0\n';
    vcard += `FN:${contact.name || 'Unknown'}\n`;
    vcard += `ORG:${contact.organization || ''};\n`;
    
    if (contact.phone) {
        vcard += `TEL;type=CELL;type=VOICE;waid=${contact.phone}:${contact.phone}\n`;
    }
    
    if (contact.email) {
        vcard += `EMAIL:${contact.email}\n`;
    }
    
    vcard += 'END:VCARD';
    
    return vcard;
}

// Helper function for creating delay (already imported, but defined here for completeness)
// async function delay(ms) {
//     return new Promise(resolve => setTimeout(resolve, ms));
// }

// Export all functions
module.exports = {
    sendText,
    sendImage,
    sendVideo,
    sendAudio,
    sendDocument,
    sendContact,
    sendLocation,
    sendListMessage,
    sendTemplate,
    sendReaction,
    sendWithLinkPreview,
    sendBatch,
    broadcast,
    deleteMessage,
    updateMessage,
    sendPoll,
    sendRaw
};