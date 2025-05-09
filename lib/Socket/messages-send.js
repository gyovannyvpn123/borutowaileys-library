"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeMessagesSocket = void 0;
const node_cache_1 = __importDefault(require("@cacheable/node-cache"));
const boom_1 = require("@hapi/boom");
const WAProto_1 = require("../../WAProto");
const Defaults_1 = require("../Defaults");
const Utils_1 = require("../Utils");
const link_preview_1 = require("../Utils/link-preview");
const WABinary_1 = require("../WABinary");
const WAUSync_1 = require("../WAUSync");
const groups_1 = require("./groups");

/**
 * Versiune ĂŽmbunÄtÄČitÄ a modulului messages-send cu suport pentru:
 * - ReĂŽncercÄri automate
 * - Raportarea detaliatÄ a statusului mesajelor
 * - FuncČie pentru trimiterea mesajelor ĂŽn lot
 * - Monitorizare ĂŽmbunÄtÄČitÄ a livrÄrii
 */
const makeMessagesSocket = (config) => {
    const { logger, linkPreviewImageThumbnailWidth, generateHighQualityLinkPreview, options: axiosOptions, patchMessageBeforeSending, cachedGroupMetadata, } = config;
    const sock = (0, groups_1.makeGroupsSocket)(config);
    const { ev, authState, processingMutex, signalRepository, upsertMessage, query, fetchPrivacySettings, sendNode, groupMetadata, groupToggleEphemeral, } = sock;
    const userDevicesCache = config.userDevicesCache || new node_cache_1.default({
        stdTTL: Defaults_1.DEFAULT_CACHE_TTLS.USER_DEVICES,
        useClones: false
    });
    let mediaConn;
    const refreshMediaConn = async (forceGet = false) => {
        const media = await mediaConn;
        if (!media || forceGet || (new Date().getTime() - media.fetchDate.getTime()) > media.ttl * 1000) {
            mediaConn = (async () => {
                const result = await query({
                    tag: 'iq',
                    attrs: {
                        type: 'set',
                        xmlns: 'w:m',
                        to: WABinary_1.S_WHATSAPP_NET,
                    },
                    content: [{ tag: 'media_conn', attrs: {} }]
                });
                const mediaConnNode = (0, WABinary_1.getBinaryNodeChild)(result, 'media_conn');
                const node = {
                    hosts: (0, WABinary_1.getBinaryNodeChildren)(mediaConnNode, 'host').map(({ attrs }) => ({
                        hostname: attrs.hostname,
                        maxContentLengthBytes: +attrs.maxContentLengthBytes,
                    })),
                    auth: mediaConnNode.attrs.auth,
                    ttl: +mediaConnNode.attrs.ttl,
                    fetchDate: new Date()
                };
                logger.debug('fetched media conn');
                return node;
            })();
        }
        return mediaConn;
    };
    /**
     * generic send receipt function
     * used for receipts of phone call, read, delivery etc.
     * */
    const sendReceipt = async (jid, participant, messageIds, type) => {
        const node = {
            tag: 'receipt',
            attrs: {
                id: messageIds[0],
            },
        };
        const isReadReceipt = type === 'read' || type === 'read-self';
        if (isReadReceipt) {
            node.attrs.t = (0, Utils_1.unixTimestampSeconds)().toString();
        }
        if (type === 'sender' && (0, WABinary_1.isJidUser)(jid)) {
            node.attrs.recipient = jid;
            node.attrs.to = participant;
        }
        else {
            node.attrs.to = jid;
            if (participant) {
                node.attrs.participant = participant;
            }
        }
        if (type) {
            node.attrs.type = type;
        }
        const remainingMessageIds = messageIds.slice(1);
        if (remainingMessageIds.length) {
            node.content = [
                {
                    tag: 'list',
                    attrs: {},
                    content: remainingMessageIds.map(id => ({
                        tag: 'item',
                        attrs: { id }
                    }))
                }
            ];
        }
        logger.debug({ attrs: node.attrs, messageIds }, 'sending receipt for messages');
        await sendNode(node);
    };
    /** Correctly bulk send receipts to multiple chats, participants */
    const sendReceipts = async (keys, type) => {
        const recps = (0, Utils_1.aggregateMessageKeysNotFromMe)(keys);
        for (const { jid, participant, messageIds } of recps) {
            await sendReceipt(jid, participant, messageIds, type);
        }
    };
    /** Bulk read messages. Keys can be from different chats & participants */
    const readMessages = async (keys) => {
        const privacySettings = await fetchPrivacySettings();
        // based on privacy settings, we have to change the read type
        const readType = privacySettings.readreceipts === 'all' ? 'read' : 'read-self';
        await sendReceipts(keys, readType);
    };
    /** Fetch all the devices we've to send a message to */
    const getUSyncDevices = async (jids, useCache, ignoreZeroDevices) => {
        var _a;
        const deviceResults = [];
        if (!useCache) {
            logger.debug('not using cache for devices');
        }
        const toFetch = [];
        jids = Array.from(new Set(jids));
        for (let jid of jids) {
            const user = (_a = (0, WABinary_1.jidDecode)(jid)) === null || _a === void 0 ? void 0 : _a.user;
            jid = (0, WABinary_1.jidNormalizedUser)(jid);
            if (useCache) {
                const devices = userDevicesCache.get(user);
                if (devices) {
                    deviceResults.push(...devices);
                    logger.trace({ user }, 'using cache for devices');
                }
                else {
                    toFetch.push(jid);
                }
            }
            else {
                toFetch.push(jid);
            }
        }
        if (!toFetch.length) {
            return deviceResults;
        }
        const query = new WAUSync_1.USyncQuery()
            .withContext('message')
            .withDeviceProtocol();
        for (const jid of toFetch) {
            query.withUser(new WAUSync_1.USyncUser().withId(jid));
        }
        const result = await sock.executeUSyncQuery(query);
        if (result) {
            const extracted = (0, Utils_1.extractDeviceJids)(result === null || result === void 0 ? void 0 : result.list, authState.creds.me.id, ignoreZeroDevices);
            const deviceMap = {};
            for (const jid of extracted) {
                var _b;
                const user = (_b = (0, WABinary_1.jidDecode)(jid)) === null || _b === void 0 ? void 0 : _b.user;
                const devicesForUser = deviceMap[user] || [];
                deviceMap[user] = devicesForUser;
                devicesForUser.push(jid);
            }
            for (const key in deviceMap) {
                userDevicesCache.set(key, deviceMap[key]);
            }
            deviceResults.push(...extracted);
        }
        return deviceResults;
    };
    const assertSessions = async (jids, useCache) => {
        const jidsRequiringFetch = [];
        if (useCache) {
            for (const jid of jids) {
                if (!signalRepository.jidHasSession(jid)) {
                    jidsRequiringFetch.push(jid);
                }
            }
        }
        else {
            jidsRequiringFetch.push(...jids);
        }
        if (jidsRequiringFetch.length) {
            logger.debug({ jidsRequiringFetch }, 'fetching sessions');
            await sock.fetchAnyDeviceForUser(jidsRequiringFetch);
        }
    };
    const createParticipantNodes = async (jids, message, extraAttrs) => {
        const devices = await getUSyncDevices(jids, true, message.irregularities?.missingDevices ? true : false);
        await assertSessions(devices, true);
        const nodes = [];
        for (const jid of devices) {
            nodes.push({
                tag: 'to',
                attrs: { jid },
                content: [{
                        tag: 'enc',
                        attrs: { v: '2', type: 'msg' },
                        content: await signalRepository.encryptMessage({
                            jid,
                            data: (0, WABinary_1.encodeBinaryNodeLegacy)(message)
                        })
                    }]
            });
        }
        return nodes;
    };
    const relayMessage = async (jid, message, { messageId: msgId, participant, additionalAttributes, additionalNodes, useUserDevicesCache, useCachedGroupMetadata, statusJidList }) => {
        var _a;
        const meId = authState.creds.me.id;
        let shouldIncludeDeviceIdentity = false;
        const { user, server } = (0, WABinary_1.jidDecode)(jid);
        const statusJid = 'status@broadcast';
        const isGroup = server === 'g.us';
        const isStatus = jid === statusJid;
        const isLid = server === 'lid';
        msgId = msgId || (0, Utils_1.generateMessageIDV2)((_a = sock.user) === null || _a === void 0 ? void 0 : _a.id);
        useUserDevicesCache = useUserDevicesCache !== false;
        useCachedGroupMetadata = useCachedGroupMetadata !== false && !isStatus;
        const participants = [];
        const destinationJid = (!isStatus) ? (0, WABinary_1.jidEncode)(user, isLid ? 'lid' : isGroup ? 'g.us' : 's.whatsapp.net') : statusJid;
        const binaryNodeContent = [];
        const devices = [];
        const meMsg = {
            deviceSentMessage: {
                destinationJid,
                message
            }
        };
        const extraAttrs = {};
        if (participant) {
            // when the retry request is not for a group
            // only send to the specific device that asked for a retry
            // otherwise the message is sent out to every device that should be a recipient
            if (server === 's.whatsapp.net' || server === 'lid') {
                additionalAttributes = { ...additionalAttributes, device_fanout: 'false' };
            }
            extraAttrs.participant = participant;
        }
        const me = shouldIncludeDeviceIdentity && sock.user ? ({
            tag: 'device-identity',
            attrs: {},
            content: (0, Utils_1.encodeSignedDeviceIdentity)(authState.creds.account, true)
        }) : undefined;
        if (me) {
            extraAttrs.deviceIdentity = me;
        }
        const stanza = {
            tag: 'message',
            attrs: {
                id: msgId,
                type: 'text',
                to: destinationJid,
                ...(additionalAttributes || {})
            }
        };
        // Status messages are sent out to multiple JIDs
        if (isStatus) {
            const statusJids = statusJidList || (await sock.getJidStatusList());
            for (const statusJid of statusJids) {
                if (statusJid) {
                    let meJid = '';
                    if (sock.user) {
                        meJid = (0, WABinary_1.jidEncode)(sock.user.id.split(':')[0], 's.whatsapp.net');
                    }
                    const isMyStatus = statusJid === meJid;
                    const participant = { tag: 'participant', attrs: { jid: statusJid } };
                    const broadcast = { tag: 'broadcast', attrs: {} };
                    const to = {
                        tag: 'to',
                        attrs: { jid: statusJid, count: '1' },
                        content: isMyStatus ? [
                            { tag: 'user', attrs: { jid: meJid } },
                            participant,
                            broadcast
                        ] : [participant, broadcast]
                    };
                    binaryNodeContent.push(to);
                }
            }
        }
        if (participants.length) {
            stanza.content = [{
                    tag: 'participants',
                    attrs: {},
                    content: participants
                }];
        }
        // Restrict message to specific JID/device, when socket connection is unstable
        // This feature is not yet fully implemented in WhatsApp yet
        const deterministic = false;
        if (deterministic && sock.user) {
            stanza.attrs.d_id = sock.user.id;
        }
        let shouldHaveIdentity = true;
        // if it's a status broadcast
        if (isStatus) {
            shouldHaveIdentity = false;
            meMsg.deviceSentMessage.phash = config.options?.statusPhash || 'status@broadcast';
        }
        // if the message is in a group,
        // and I am not explicitly mentioned in the message
        // if it's a disappearing message that's not from me
        // or if it's from me but I explicitly kept non-biz account
        else if (isGroup &&
            // cannot use my own user jid in may places
            (sock.user?.id?.includes(':')
                ? !Utils_1.areJidsSameUser(meId, participant || '')
                : !participant)) {
            const senderJid = participant || '';
            // find if I was mentioned in the message
            let mentioned = false;
            if (message.extendedTextMessage?.contextInfo?.mentionedJid) {
                for (const jid of message.extendedTextMessage.contextInfo.mentionedJid) {
                    if (Utils_1.areJidsSameUser(meId, jid)) {
                        mentioned = true;
                        break;
                    }
                }
            }
            if (mentioned) {
                // if I was mentioned, then keep the DI
                shouldHaveIdentity = true;
            }
            else if (sock.user?.id) {
                const senderUserJid = (0, WABinary_1.jidNormalizedUser)(senderJid);
                // if the user is neither me or mentions, nor a biz account linked to any DI
                const isFromNonBizAccount = (0, Utils_1.getEntryFor)({ id: senderUserJid, storageKey: authState.creds.accountSettings?.storageKey }, authState.creds.accountSettings)?.value?.value !== 'biz';
                const isFromTheSecondaryDevice = isFromNonBizAccount && Utils_1.areJidsSameUser(senderJid, sock.user.id) && senderJid !== sock.user.id;
                // if the sender is not me
                // or it's from another device of mine
                // and it's not a business account
                // then drop the DI
                const keepDi = Boolean(config.keepDeviceIdentity);
                shouldHaveIdentity = (!Utils_1.areJidsSameUser(senderJid, sock.user.id) || !isFromNonBizAccount || isFromTheSecondaryDevice) || keepDi;
            }
        }
        binaryNodeContent.push({
            tag: 'enc',
            attrs: { v: '2', type: 'skmsg' },
            content: (0, Utils_1.encodeSenderKeyMessage)({
                senderKeyId: senderKeyMap[jid].keyId,
                senderKey: senderKeyMap[jid].senderKey,
                msg: (0, WABinary_1.encodeBinaryNodeLegacy)(shouldHaveIdentity ? { ...meMsg } : { deviceSentMessage: { destinationJid, message } })
            })
        });
        if (additionalNodes === null || additionalNodes === void 0 ? void 0 : additionalNodes.length) {
            binaryNodeContent.push(...additionalNodes);
        }
        stanza.content = [...stanza.content || [], ...binaryNodeContent];
        const sentMsg = await sock.query({
            tag: 'message',
            attrs: {
                id: msgId,
                type: 'text',
                to: destinationJid,
                ...(additionalAttributes || {}),
                ...extraAttrs
            },
            content: binaryNodeContent
        });
        return msgId;
    };
    
    /**
     * FuncČie auxiliarÄ pentru monitorizarea livrÄrii mesajelor
     * @param {string} messageId - ID-ul mesajului
     * @param {Function} statusCallback - Callback pentru actualizÄri de status
     * @param {number} timeout - Timeout ĂŽn milisecunde
     */
    const trackMessageDelivery = (messageId, statusCallback, timeout = 30000) => {
        if (typeof statusCallback !== 'function') {
            return;
        }
        
        const deliveryTimeout = setTimeout(() => {
            statusCallback({ status: 'delivery_timeout', data: { messageId }, timestamp: new Date() });
            ev.off('messages.update', deliveryCheck);
        }, timeout);
        
        const deliveryCheck = (updates) => {
            for (const update of updates) {
                if (update.key && update.key.id === messageId) {
                    if (update.status) {
                        statusCallback({ 
                            status: 'status_update', 
                            data: { messageId, status: update.status },
                            timestamp: new Date()
                        });
                        
                        // CĂ˘nd primim confirmarea de livrare sau citire, oprim monitorizarea
                        if (update.status === 'delivery_ack' || update.status === 'read') {
                            clearTimeout(deliveryTimeout);
                            ev.off('messages.update', deliveryCheck);
                        }
                    }
                }
            }
        };
        
        ev.on('messages.update', deliveryCheck);
        
        // ReturnÄm o funcČie pentru a anula monitorizarea dacÄ e necesar
        return () => {
            clearTimeout(deliveryTimeout);
            ev.off('messages.update', deliveryCheck);
        };
    };
    
    /**
     * FuncČie pentru reĂŽncercarea unui mesaj ĂŽn caz de eČec
     * @param {Function} fn - FuncČia de ĂŽncercat
     * @param {Object} options - OpČiuni pentru reĂŽncercÄri
     */
    const withRetry = async (fn, options = {}) => {
        const maxRetries = options.retryCount || 3;
        const retryDelay = options.retryDelay || 1500;
        const statusCallback = options.statusCallback;
        
        let lastError = null;
        let attempt = 0;
        
        const reportStatus = (status, data = {}) => {
            if (typeof statusCallback === 'function') {
                statusCallback({ status, data, timestamp: new Date() });
            }
        };
        
        while (attempt < maxRetries) {
            try {
                attempt++;
                if (attempt > 1) {
                    reportStatus('retrying', { attempt, maxAttempts: maxRetries });
                    await new Promise(resolve => setTimeout(resolve, retryDelay * (attempt - 1))); // Delay exponencial
                }
                
                const result = await fn();
                return result;
            } catch (error) {
                lastError = error;
                reportStatus('error', { 
                    error: error.message, 
                    attempt, 
                    code: error.code || 'UNKNOWN_ERROR' 
                });
                
                // VerificÄm dacÄ eroarea este permanentÄ sau poate fi ĂŽncercatÄ din nou
                if (error.permanent || 
                    error.code === 'PERMANENTLY_BLOCKED' || 
                    error.code === 'BAD_REQUEST' || 
                    error.message?.includes('not-authorized')) {
                    break; // Nu are rost sÄ mai reĂŽncercÄm
                }
            }
        }
        
        // DacÄ am epuizat toate ĂŽncercÄrile, aruncÄm ultima eroare
        if (lastError) {
            reportStatus('failed', { 
                error: lastError.message, 
                attempts: attempt,
                code: lastError.code || 'MAX_RETRIES_EXCEEDED'
            });
            
            throw lastError;
        }
    };
    
    /**
     * FuncČie pentru pregÄtirea Či validarea opČiunilor unui mesaj
     * @param {Object} options - OpČiunile mesajului
     */
    const prepareMessageOptions = (options = {}) => {
        // Valorile default pentru opČiuni
        return {
            retryCount: options.retryCount || 3,
            retryDelay: options.retryDelay || 1500,
            trackDelivery: options.trackDelivery || false,
            trackingTimeout: options.trackingTimeout || 30000,
            statusCallback: options.statusCallback,
            useUserDevicesCache: options.useUserDevicesCache ?? true,
            useCachedGroupMetadata: options.useCachedGroupMetadata ?? true,
            ...options
        };
    };
    
    // AdÄugÄm funcČiile ĂŽmbunÄtÄČite la obiectul returnat
    return {
        ...sock,
        /**
         * Versiune ĂŽmbunÄtÄČitÄ a funcČiei sendMessage cu suport pentru reĂŽncercÄri automate
         * Či raportare detaliatÄ a statusului
         */
        sendMessage: async (jid, content, options = {}) => {
            var _a, _b, _c;
            const userJid = authState.creds.me.id;
            
            // PregÄtim opČiunile cu valorile implicite
            const enhancedOptions = prepareMessageOptions(options);
            const { statusCallback, trackDelivery, trackingTimeout } = enhancedOptions;
            
            // FuncČie helper pentru raportarea statusului
            const reportStatus = (status, data = {}) => {
                if (typeof statusCallback === 'function') {
                    statusCallback({ status, data, timestamp: new Date() });
                }
            };
            
            reportStatus('preparing', { jid });
            
            if (typeof content === 'object' &&
                'disappearingMessagesInChat' in content &&
                typeof content['disappearingMessagesInChat'] !== 'undefined' &&
                (0, WABinary_1.isJidGroup)(jid)) {
                const { disappearingMessagesInChat } = content;
                const value = typeof disappearingMessagesInChat === 'boolean' ?
                    (disappearingMessagesInChat ? Defaults_1.WA_DEFAULT_EPHEMERAL : 0) :
                    disappearingMessagesInChat;
                await groupToggleEphemeral(jid, value);
            }
            else {
                // Folosim funcČia withRetry pentru a gestiona reĂŽncercÄrile automate
                return await withRetry(async () => {
                    reportStatus('generating', {});
                    
                    const fullMsg = await (0, Utils_1.generateWAMessage)(jid, content, {
                        logger,
                        userJid,
                        getUrlInfo: text => (0, link_preview_1.getUrlInfo)(text, {
                            thumbnailWidth: linkPreviewImageThumbnailWidth,
                            fetchOpts: {
                                timeout: 3000,
                                ...axiosOptions || {}
                            },
                            logger,
                            uploadImage: generateHighQualityLinkPreview
                                ? waUploadToServer
                                : undefined
                        }),
                        getProfilePicUrl: sock.profilePictureUrl,
                        upload: waUploadToServer,
                        mediaCache: config.mediaCache,
                        options: config.options,
                        messageId: (0, Utils_1.generateMessageIDV2)((_a = sock.user) === null || _a === void 0 ? void 0 : _a.id),
                        ...options,
                    });
                    
                    // Patchuim mesajul ĂŽnainte de trimitere dacÄ e necesar
                    if(patchMessageBeforeSending) {
                        await patchMessageBeforeSending(fullMsg);
                    }
                    
                    const isDeleteMsg = 'delete' in content && !!content.delete;
                    const isEditMsg = 'edit' in content && !!content.edit;
                    const isPinMsg = 'pin' in content && !!content.pin;
                    const isPollMessage = 'poll' in content && !!content.poll;
                    
                    const additionalAttributes = {};
                    const additionalNodes = [];
                    
                    // Atribute necesare pentru diverse tipuri de mesaje
                    if (isDeleteMsg) {
                        if ((0, WABinary_1.isJidGroup)((_b = content.delete) === null || _b === void 0 ? void 0 : _b.remoteJid) && !((_c = content.delete) === null || _c === void 0 ? void 0 : _c.fromMe)) {
                            additionalAttributes.edit = '8';
                        }
                        else {
                            additionalAttributes.edit = '7';
                        }
                    }
                    else if (isEditMsg) {
                        additionalAttributes.edit = '1';
                    }
                    else if (isPinMsg) {
                        additionalAttributes.edit = '2';
                    }
                    else if (isPollMessage) {
                        additionalNodes.push({
                            tag: 'meta',
                            attrs: {
                                polltype: 'creation'
                            },
                        });
                    }
                    
                    // AdÄugÄm trackingId pentru monitorizarea mesajului dacÄ este furnizat
                    if (options.trackingId) {
                        additionalAttributes.trackingId = options.trackingId;
                    }
                    
                    reportStatus('sending', { messageId: fullMsg.key.id });
                    
                    // VerificÄm dacÄ opČiunea de cachedGroupMetadata este ĂŽn opČiuni (deprecated)
                    if ('cachedGroupMetadata' in options) {
                        console.warn('cachedGroupMetadata in sendMessage are deprecated, now cachedGroupMetadata is part of the socket config.');
                    }
                    
                    // Trimitem mesajul efectiv
                    await relayMessage(jid, fullMsg.message, { 
                        messageId: fullMsg.key.id, 
                        useCachedGroupMetadata: enhancedOptions.useCachedGroupMetadata, 
                        additionalAttributes, 
                        statusJidList: options.statusJidList, 
                        additionalNodes,
                        useUserDevicesCache: enhancedOptions.useUserDevicesCache
                    });
                    
                    reportStatus('sent', { messageId: fullMsg.key.id });
                    
                    if (config.emitOwnEvents) {
                        process.nextTick(() => {
                            processingMutex.mutex(() => (upsertMessage(fullMsg, 'append')));
                        });
                    }
                    
                    // ConfigurÄm monitorizarea livrÄrii dacÄ este cerutÄ
                    if (trackDelivery) {
                        trackMessageDelivery(
                            fullMsg.key.id, 
                            statusCallback, 
                            trackingTimeout
                        );
                    }
                    
                    return fullMsg;
                }, enhancedOptions);
            }
        },
        
        /**
         * FuncČie nouÄ pentru trimiterea ĂŽn lot a mesajelor cÄtre mai mulČi destinatari
         * @param {string[]} jids - Lista de JID-uri destinatar
         * @param {Object} content - ConČinutul mesajului
         * @param {Object} options - OpČiuni suplimentare
         */
        sendBatchMessages: async (jids, content, options = {}) => {
            const results = [];
            const failedJids = [];
            const successJids = [];
            const delay = options.batchDelay || 1000; // ms ĂŽntre mesaje pentru a evita rate limiting
            
            logger.info({ recipientCount: jids.length }, 'sending batch messages');
            
            const enhancedOptions = prepareMessageOptions(options);
            const { statusCallback } = enhancedOptions;
            
            // FuncČie helper pentru raportarea statusului
            const reportStatus = (status, data = {}) => {
                if (typeof statusCallback === 'function') {
                    statusCallback({ 
                        status, 
                        data: { ...data, batchId: options.batchId }, 
                        timestamp: new Date() 
                    });
                }
            };
            
            reportStatus('batch_started', { 
                total: jids.length, 
                content: typeof content === 'object' ? 
                    Object.keys(content) : 
                    'text message'
            });
            
            for (let i = 0; i < jids.length; i++) {
                const jid = jids[i];
                const startTime = Date.now();
                
                reportStatus('processing_recipient', { 
                    index: i, 
                    total: jids.length, 
                    jid,
                    remaining: jids.length - i
                });
                
                try {
                    // Trimite mesajul cÄtre destinatarul curent
                    const result = await sock.sendMessage(jid, content, { 
                        ...enhancedOptions,
                        statusCallback: (status) => {
                            // AdÄugÄm informaČii despre batch Či recipient
                            reportStatus(`recipient_${status.status}`, {
                                ...status.data,
                                recipientIndex: i,
                                jid
                            });
                        }
                    });
                    
                    successJids.push(jid);
                    results.push({ jid, result, success: true });
                    
                    reportStatus('recipient_success', { 
                        index: i, 
                        total: jids.length, 
                        jid, 
                        messageId: result.key.id 
                    });
                    
                    // AČteptÄm ĂŽntre mesaje pentru a evita rate limiting
                    if (i < jids.length - 1) {
                        const elapsedTime = Date.now() - startTime;
                        const waitTime = Math.max(0, delay - elapsedTime);
                        
                        if (waitTime > 0) {
                            reportStatus('batch_delay', { delay: waitTime });
                            await new Promise(resolve => setTimeout(resolve, waitTime));
                        }
                    }
                } catch (error) {
                    logger.error({ jid, error }, 'failed to send message in batch');
                    failedJids.push(jid);
                    
                    results.push({ 
                        jid, 
                        error: error.message, 
                        code: error.code || 'UNKNOWN_ERROR',
                        success: false 
                    });
                    
                    reportStatus('recipient_failed', { 
                        index: i, 
                        total: jids.length, 
                        jid, 
                        error: error.message,
                        code: error.code || 'UNKNOWN_ERROR' 
                    });
                }
            }
            
            const summary = {
                results,
                failedJids,
                successJids,
                successCount: successJids.length,
                failureCount: failedJids.length,
                totalCount: jids.length
            };
            
            reportStatus('batch_completed', summary);
            
            return summary;
        },
        
        relayMessage,
        readMessages,
        refreshMediaConn,
        sendReceipt,
        sendReceipts,
        assertSessions,
        createParticipantNodes,
        trackMessageDelivery,
        waUploadToServer
    };
};

exports.makeMessagesSocket = makeMessagesSocket;
