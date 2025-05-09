/**
 * Enhanced functional helper for sending WhatsApp messages
 * @module messages-send
 */

"use strict";

// Folosim modulele interne ale bibliotecii pentru utilitÄƒÈ›i
const Utils_1 = require("../Utils");
const WAProto_1 = require("../../WAProto");
const pino = require("pino");

// Logger configurabil
const logger = pino({ 
    level: process.env.DEBUG_LEVEL || 'silent'
});

/**
 * Send text message with improved error handling
 * 
 * @param {Object} sock - The socket connection
 * @param {string} jid - The JID to send the message to
 * @param {string} text - The message text
 * @param {Object} options - Optional parameters like quoted message, mentions, etc.
 * @returns {Promise<Object>} - The message info
 */
async function sendText(sock, jid, text, options = {}) {
    // Validate parameters
    if (!jid || (typeof jid !== 'string')) {
        throw new Error('Invalid JID: must be a non-empty string');
    }
    
    if (text === undefined || text === null) {
        throw new Error('Message text cannot be null or undefined');
    }
    
    // Convert non-string text to string
    if (typeof text !== 'string') {
        text = String(text);
    }
    
    try {
        // Process JID if it's a phone number
        if (!jid.includes('@')) {
            jid = Utils_1.jidNormalizedUser(`${jid}@s.whatsapp.net`);
        }
        
        // Format text if needed
        const formattedText = applyFormatting(text, options.formatting || {});
        
        // Configure message options
        const messageOptions = buildMessageOptions(options);
        
        // Add retry logic for reliability
        const retryCount = options.retryCount || 3;
        const retryDelay = options.retryDelay || 2000;
        
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
        logger.error({
            message: `Error sending text message`,
            error: error.message,
            jid,
            textLength: text?.length
        });
        
        throw new Error(`Failed to send text message: ${error.message}`);
    }
}

/**
 * Send image message with enhanced features
 * 
 * @param {Object} sock - The socket connection
 * @param {string} jid - The JID to send the message to
 * @param {string|Buffer} content - Image content (URL, path, or buffer)
 * @param {string} caption - Image caption
 * @param {Object} options - Message sending options
 * @returns {Promise<Object>} - The message info
 */
async function sendImage(sock, jid, content, caption = '', options = {}) {
    try {
        // Format caption if needed
        const formattedCaption = applyFormatting(caption, options.formatting || {});
        
        // Configure message options
        const messageOptions = buildMessageOptions(options);
        
        // Add retry logic
        const retryCount = options.retryCount || 3;
        const retryDelay = options.retryDelay || 2000;
        
        // Process content (URL, path, buffer)
        const imageContent = await processMediaContent(content);
        
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
        logger.error({
            message: `Error sending image message`,
            error: error.message,
            jid
        });
        
        throw new Error(`Failed to send image message: ${error.message}`);
    }
}

/**
 * Send video message with enhanced features
 * 
 * @param {Object} sock - The socket connection
 * @param {string} jid - The JID to send the message to
 * @param {string|Buffer} content - Video content (URL, path, or buffer)
 * @param {string} caption - Video caption
 * @param {Object} options - Message sending options
 * @returns {Promise<Object>} - The message info
 */
async function sendVideo(sock, jid, content, caption = '', options = {}) {
    try {
        // Format caption if needed
        const formattedCaption = applyFormatting(caption, options.formatting || {});
        
        // Configure message options
        const messageOptions = buildMessageOptions(options);
        
        // Add retry logic
        const retryCount = options.retryCount || 3;
        const retryDelay = options.retryDelay || 2000;
        
        // Process content (URL, path, buffer)
        const videoContent = await processMediaContent(content);
        
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
        logger.error({
            message: `Error sending video message`,
            error: error.message,
            jid
        });
        
        throw new Error(`Failed to send video message: ${error.message}`);
    }
}

/**
 * Send audio message with enhanced features
 * 
 * @param {Object} sock - The socket connection
 * @param {string} jid - The JID to send the message to
 * @param {string|Buffer} content - Audio content (URL, path, or buffer)
 * @param {boolean} ptt - Push to talk (voice note) format
 * @param {Object} options - Message sending options
 * @returns {Promise<Object>} - The message info
 */
async function sendAudio(sock, jid, content, ptt = false, options = {}) {
    try {
        // Configure message options
        const messageOptions = buildMessageOptions(options);
        
        // Add retry logic
        const retryCount = options.retryCount || 3;
        const retryDelay = options.retryDelay || 2000;
        
        // Process content (URL, path, buffer)
        const audioContent = await processMediaContent(content);
        
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
        logger.error({
            message: `Error sending audio message`,
            error: error.message,
            jid
        });
        
        throw new Error(`Failed to send audio message: ${error.message}`);
    }
}

/**
 * Send document message with enhanced features
 * 
 * @param {Object} sock - The socket connection
 * @param {string} jid - The JID to send the message to
 * @param {string|Buffer} content - Document content (URL, path, or buffer)
 * @param {string} filename - Document filename
 * @param {string} mimetype - Document mimetype
 * @param {Object} options - Message sending options
 * @returns {Promise<Object>} - The message info
 */
async function sendDocument(sock, jid, content, filename, mimetype = 'application/octet-stream', options = {}) {
    try {
        // Configure message options
        const messageOptions = buildMessageOptions(options);
        
        // Add retry logic
        const retryCount = options.retryCount || 3;
        const retryDelay = options.retryDelay || 2000;
        
        // Process content (URL, path, buffer)
        const documentContent = await processMediaContent(content);
        
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
        logger.error({
            message: `Error sending document message`,
            error: error.message,
            jid
        });
        
        throw new Error(`Failed to send document message: ${error.message}`);
    }
}

/**
 * Send contact information
 * 
 * @param {Object} sock - The socket connection
 * @param {string} jid - The JID to send the message to
 * @param {Array<Object>} contacts - Array of contact objects
 * @param {Object} options - Message sending options
 * @returns {Promise<Object>} - The message info
 */
async function sendContact(sock, jid, contacts, options = {}) {
    try {
        // Configure message options
        const messageOptions = buildMessageOptions(options);
        
        // Add retry logic
        const retryCount = options.retryCount || 3;
        const retryDelay = options.retryDelay || 2000;
        
        // Process contacts
        const formattedContacts = contacts.map(contact => ({
            displayName: contact.name || 'Contact',
            vcard: generateVCard(contact)
        }));
        
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
        logger.error({
            message: `Error sending contact message`,
            error: error.message,
            jid
        });
        
        throw new Error(`Failed to send contact message: ${error.message}`);
    }
}

/**
 * Send location information
 * 
 * @param {Object} sock - The socket connection
 * @param {string} jid - The JID to send the message to
 * @param {Object} locationInfo - Location information object
 * @param {Object} options - Message sending options
 * @returns {Promise<Object>} - The message info
 */
async function sendLocation(sock, jid, locationInfo, options = {}) {
    try {
        // Configure message options
        const messageOptions = buildMessageOptions(options);
        
        // Add retry logic
        const retryCount = options.retryCount || 3;
        const retryDelay = options.retryDelay || 2000;
        
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
        logger.error({
            message: `Error sending location message`,
            error: error.message,
            jid
        });
        
        throw new Error(`Failed to send location message: ${error.message}`);
    }
}

/**
 * Send list message (interactive menu)
 * 
 * @param {Object} sock - The socket connection
 * @param {string} jid - The JID to send the message to
 * @param {Object} listInfo - List information object
 * @param {Object} options - Message sending options
 * @returns {Promise<Object>} - The message info
 */
async function sendListMessage(sock, jid, listInfo, options = {}) {
    try {
        // Configure message options
        const messageOptions = buildMessageOptions(options);
        
        // Add retry logic
        const retryCount = options.retryCount || 3;
        const retryDelay = options.retryDelay || 2000;
        
        // Validate list structure
        if (!listInfo.title || !listInfo.text || !Array.isArray(listInfo.sections)) {
            throw new Error('Invalid list structure, must include title, text, and sections array');
        }
        
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
        logger.error({
            message: `Error sending list message`,
            error: error.message,
            jid
        });
        
        throw new Error(`Failed to send list message: ${error.message}`);
    }
}

/**
 * Send template/button message
 * 
 * @param {Object} sock - The socket connection
 * @param {string} jid - The JID to send the message to
 * @param {Object} templateInfo - Template information object
 * @param {Object} options - Message sending options
 * @returns {Promise<Object>} - The message info
 */
async function sendTemplate(sock, jid, templateInfo, options = {}) {
    try {
        // Configure message options
        const messageOptions = buildMessageOptions(options);
        
        // Add retry logic
        const retryCount = options.retryCount || 3;
        const retryDelay = options.retryDelay || 2000;
        
        // Validate template structure
        if (!templateInfo.text) {
            throw new Error('Template must include text');
        }
        
        // Format text if needed
        const formattedText = applyFormatting(templateInfo.text, options.formatting || {});
        
        return await sendWithRetry(
            async () => {
                return await sock.sendMessage(
                    jid, 
                    {
                        text: formattedText,
                        footer: templateInfo.footer || '',
                        templateButtons: templateInfo.buttons || []
                    },
                    messageOptions
                );
            },
            retryCount,
            retryDelay
        );
    } catch (error) {
        logger.error({
            message: `Error sending template message`,
            error: error.message,
            jid
        });
        
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
        logger.error({
            message: `Error sending reaction`,
            error: error.message,
            jid,
            emoji
        });
        
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
 * @param {Object} options - Message sending options
 * @returns {Promise<Object>} - The message info
 */
async function sendWithLinkPreview(sock, jid, text, previewInfo = {}, options = {}) {
    try {
        // Format text if needed
        const formattedText = applyFormatting(text, options.formatting || {});
        
        // Configure message options
        const messageOptions = buildMessageOptions(options);
        
        // Add retry logic
        const retryCount = options.retryCount || 3;
        const retryDelay = options.retryDelay || 2000;
        
        // Extract link from text if needed
        const linkPreviewOptions = {
            canonicalUrl: previewInfo.url,
            matchedText: previewInfo.matchedText || previewInfo.url || text,
            title: previewInfo.title || '',
            description: previewInfo.description || '',
            jpegThumbnail: previewInfo.thumbnail ? await processMediaContent(previewInfo.thumbnail) : undefined
        };
        
        return await sendWithRetry(
            async () => {
                return await sock.sendMessage(
                    jid, 
                    { 
                        text: formattedText,
                        contextInfo: {
                            externalAdReply: linkPreviewOptions
                        }
                    },
                    messageOptions
                );
            },
            retryCount,
            retryDelay
        );
    } catch (error) {
        logger.error({
            message: `Error sending message with link preview`,
            error: error.message,
            jid
        });
        
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
    const results = [];
    const errors = [];
    
    for (const [index, msg] of messages.entries()) {
        try {
            // Wait between messages to avoid rate limiting
            if (index > 0) {
                await delay(delayBetweenMs);
            }
            
            let result;
            
            // Process based on message type
            switch (msg.type) {
                case 'text':
                    result = await sendText(sock, msg.jid, msg.text, msg.options);
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
                case 'location':
                    result = await sendLocation(sock, msg.jid, msg.locationInfo, msg.options);
                    break;
                case 'contacts':
                    result = await sendContact(sock, msg.jid, msg.contacts, msg.options);
                    break;
                case 'list':
                    result = await sendListMessage(sock, msg.jid, msg.listInfo, msg.options);
                    break;
                case 'template':
                    result = await sendTemplate(sock, msg.jid, msg.templateInfo, msg.options);
                    break;
                case 'link':
                    result = await sendWithLinkPreview(sock, msg.jid, msg.text, msg.previewInfo, msg.options);
                    break;
                default:
                    throw new Error(`Unknown message type: ${msg.type}`);
            }
            
            results.push({
                success: true,
                messageInfo: result,
                index
            });
        } catch (error) {
            logger.error({
                message: `Error in batch send for message at index ${index}`,
                error: error.message,
                messageType: msg.type,
                jid: msg.jid
            });
            
            results.push({
                success: false,
                error: error.message,
                index
            });
            
            errors.push({
                index,
                error
            });
        }
    }
    
    return {
        results,
        errors,
        success: errors.length === 0,
        successCount: results.filter(r => r.success).length,
        errorCount: errors.length
    };
}

/**
 * Send message to multiple recipients (broadcast)
 * 
 * @param {Object} sock - The socket connection
 * @param {Array<string>} jids - Array of JIDs to send to
 * @param {Object} messageContent - The message content object
 * @param {Object} options - Message sending options
 * @returns {Promise<Object>} - Results object
 */
async function broadcast(sock, jids, messageContent, options = {}) {
    const results = [];
    const errors = [];
    const delayBetweenMs = options.delayBetweenMs || 1000;
    
    // Determine message type and content
    let sendFunction;
    let msgArgs = [];
    
    if (messageContent.text) {
        sendFunction = sendText;
        msgArgs = [messageContent.text, options];
    } else if (messageContent.image) {
        sendFunction = sendImage;
        msgArgs = [messageContent.image, messageContent.caption || '', options];
    } else if (messageContent.video) {
        sendFunction = sendVideo;
        msgArgs = [messageContent.video, messageContent.caption || '', options];
    } else if (messageContent.audio) {
        sendFunction = sendAudio;
        msgArgs = [messageContent.audio, messageContent.ptt || false, options];
    } else if (messageContent.document) {
        sendFunction = sendDocument;
        msgArgs = [messageContent.document, messageContent.filename, messageContent.mimetype || 'application/octet-stream', options];
    } else if (messageContent.location) {
        sendFunction = sendLocation;
        msgArgs = [messageContent.location, options];
    } else if (messageContent.contacts) {
        sendFunction = sendContact;
        msgArgs = [messageContent.contacts, options];
    } else if (messageContent.list) {
        sendFunction = sendListMessage;
        msgArgs = [messageContent.list, options];
    } else if (messageContent.template) {
        sendFunction = sendTemplate;
        msgArgs = [messageContent.template, options];
    } else {
        throw new Error('Invalid message content for broadcast');
    }
    
    for (const [index, jid] of jids.entries()) {
        try {
            // Wait between messages to avoid rate limiting
            if (index > 0) {
                await delay(delayBetweenMs);
            }
            
            const result = await sendFunction(sock, jid, ...msgArgs);
            
            results.push({
                success: true,
                messageInfo: result,
                jid,
                index
            });
        } catch (error) {
            logger.error({
                message: `Error in broadcast for jid ${jid}`,
                error: error.message,
                index
            });
            
            results.push({
                success: false,
                error: error.message,
                jid,
                index
            });
            
            errors.push({
                jid,
                index,
                error
            });
        }
    }
    
    return {
        results,
        errors,
        success: errors.length === 0,
        successCount: results.filter(r => r.success).length,
        errorCount: errors.length
    };
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
        return await sock.sendMessage(
            jid, 
            { 
                delete: key 
            }
        );
    } catch (error) {
        logger.error({
            message: `Error deleting message`,
            error: error.message,
            jid,
            messageId: key.id
        });
        
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
 * @param {Object} options - Message options
 * @returns {Promise<Object>} - Result object
 */
async function updateMessage(sock, jid, text, key, options = {}) {
    try {
        // Format text if needed
        const formattedText = applyFormatting(text, options.formatting || {});
        
        // Use edit type based on protocol version
        return await sock.sendMessage(
            jid, 
            { 
                text: formattedText,
                edit: key 
            }
        );
    } catch (error) {
        logger.error({
            message: `Error updating message`,
            error: error.message,
            jid,
            messageId: key.id
        });
        
        throw new Error(`Failed to update message: ${error.message}`);
    }
}

/**
 * Send a poll message
 * 
 * @param {Object} sock - The socket connection
 * @param {string} jid - The JID to send to
 * @param {Object} pollData - Poll data object
 * @param {Object} options - Message options
 * @returns {Promise<Object>} - Result object
 */
async function sendPoll(sock, jid, pollData, options = {}) {
    try {
        // Validate poll data
        if (!pollData.name || !Array.isArray(pollData.options) || pollData.options.length < 2) {
            throw new Error('Invalid poll data: must include name and at least 2 options');
        }
        
        // Configure message options
        const messageOptions = buildMessageOptions(options);
        
        // Add retry logic
        const retryCount = options.retryCount || 3;
        const retryDelay = options.retryDelay || 2000;
        
        // Convert poll options to correct format
        const pollOptions = pollData.options.map(option => ({
            optionName: option
        }));
        
        return await sendWithRetry(
            async () => {
                return await sock.sendMessage(
                    jid, 
                    {
                        poll: {
                            name: pollData.name,
                            options: pollOptions,
                            selectableOptionsCount: pollData.multiSelect ? pollOptions.length : 1
                        }
                    },
                    messageOptions
                );
            },
            retryCount,
            retryDelay
        );
    } catch (error) {
        logger.error({
            message: `Error sending poll message`,
            error: error.message,
            jid
        });
        
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
        // Configure message options
        const messageOptions = buildMessageOptions(options);
        
        // Add retry logic
        const retryCount = options.retryCount || 3;
        const retryDelay = options.retryDelay || 2000;
        
        return await sendWithRetry(
            async () => {
                // Create a message content based on WAProto
                const message = content;
                
                return await sock.sendMessage(jid, message, messageOptions);
            },
            retryCount,
            retryDelay
        );
    } catch (error) {
        logger.error({
            message: `Error sending raw message`,
            error: error.message,
            jid
        });
        
        throw new Error(`Failed to send raw message: ${error.message}`);
    }
}

/**
 * Helper function to apply text formatting
 * 
 * @param {string} text - Text to format
 * @param {Object} formatting - Formatting options
 * @returns {string} - Formatted text
 */
function applyFormatting(text, formatting = {}) {
    if (!text) return text;
    
    let formattedText = text;
    
    // Monospace must be applied before other formatting
    if (formatting.monospace) {
        formattedText = "```" + formattedText + "```";
    }
    
    if (formatting.bold) {
        formattedText = "*" + formattedText + "*";
    }
    
    if (formatting.italic) {
        formattedText = "_" + formattedText + "_";
    }
    
    if (formatting.strikethrough) {
        formattedText = "~" + formattedText + "~";
    }
    
    return formattedText;
}

/**
 * Create message options object
 * 
 * @param {Object} options - User provided options
 * @returns {Object} - Message options object
 */
function buildMessageOptions(options = {}) {
    const messageOptions = {};
    
    // Handle quoted message
    if (options.quoted) {
        messageOptions.quoted = options.quotedMessage || options.quoted;
    }
    
    // Handle mentions
    if (options.mentions !== false && options.mentionedJid?.length) {
        messageOptions.mentions = options.mentionedJid;
    }
    
    // Handle ephemeral messages
    if (options.ephemeralExpiration) {
        messageOptions.ephemeralExpiration = options.ephemeralExpiration;
    }
    
    // Handle view once
    if (options.viewOnce) {
        messageOptions.viewOnce = true;
    }
    
    // Handle additional context info
    if (options.contextInfo && typeof options.contextInfo === 'object') {
        messageOptions.contextInfo = options.contextInfo;
    }
    
    return messageOptions;
}

/**
 * Process media content (URL/path/buffer)
 * 
 * @param {string|Buffer} content - Content to process
 * @returns {Promise<Buffer>} - Processed content as buffer
 */
async function processMediaContent(content) {
    if (!content) {
        throw new Error('Media content is required');
    }
    
    // If already a buffer, return as is
    if (Buffer.isBuffer(content)) {
        return content;
    }
    
    // If a string, check if URL or local path
    if (typeof content === 'string') {
        // Check if URL
        if (content.startsWith('http://') || content.startsWith('https://')) {
            return await downloadContent(content);
        }
        
        // Check if local file path
        if (content.startsWith('/') || content.startsWith('./') || content.startsWith('../')) {
            try {
                return await fs.promises.readFile(content);
            } catch (error) {
                throw new Error(`Failed to read file at ${content}: ${error.message}`);
            }
        }
    }
    
    throw new Error('Invalid content type, must be URL, file path, or Buffer');
}

/**
 * Download content from URL
 * 
 * @param {string} url - URL to download
 * @returns {Promise<Buffer>} - Downloaded content as buffer
 */
function downloadContent(url) {
    return new Promise((resolve, reject) => {
        const httpModule = url.startsWith('https:') ? require('https') : require('http');
        
        httpModule.get(url, (response) => {
            if (response.statusCode !== 200) {
                reject(new Error(`Failed to download media: HTTP status ${response.statusCode}`));
                return;
            }
            
            const chunks = [];
            
            response.on('data', (chunk) => chunks.push(chunk));
            response.on('end', () => resolve(Buffer.concat(chunks)));
            response.on('error', (err) => reject(new Error(`Failed to download media: ${err.message}`)));
        }).on('error', (err) => {
            reject(new Error(`Failed to download media: ${err.message}`));
        });
    });
}

/**
 * Create a delay
 * 
 * @param {number} ms - Milliseconds to delay
 * @returns {Promise<void>} - Promise that resolves after delay
 */
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Execute a function with retry logic
 * 
 * @param {Function} sendFunction - Function to execute
 * @param {number} maxRetries - Maximum number of retries
 * @param {number} initialDelayMs - Initial delay between retries
 * @returns {Promise<any>} - Result from the function
 */
async function sendWithRetry(sendFunction, maxRetries = 3, initialDelayMs = 2000) {
    let lastError;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await sendFunction();
        } catch (error) {
            lastError = error;
            
            if (attempt < maxRetries) {
                const delayMs = initialDelayMs * Math.pow(2, attempt);
                logger.info(`Retry attempt ${attempt + 1}/${maxRetries} after ${delayMs}ms`);
                await delay(delayMs);
            }
        }
    }
    
    throw lastError;
}

/**
 * Generate vCard for contact sharing
 * 
 * @param {Object} contact - Contact information
 * @returns {string} - vCard string
 */
function generateVCard(contact) {
    const name = contact.name || 'Unknown';
    const org = contact.organization || '';
    const phone = contact.phone || '';
    const email = contact.email || '';
    
    return `BEGIN:VCARD\nVERSION:3.0\nFN:${name}\nORG:${org}\nTEL;type=CELL;type=VOICE;waid=${phone}:${phone}\nEMAIL:${email}\nEND:VCARD`;
}

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
