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

const makeMessagesSocket = (config) => {
    const {
        logger,
        linkPreviewImageThumbnailWidth,
        generateHighQualityLinkPreview,
        options: axiosOptions,
        patchMessageBeforeSending,
        cachedGroupMetadata,
    } = config;
    const sock = (0, groups_1.makeGroupsSocket)(config);
    const {
        ev,
        authState,
        processingMutex,
        signalRepository,
        upsertMessage,
        query,
        fetchPrivacySettings,
        sendNode,
        groupMetadata,
        groupToggleEphemeral,
    } = sock;
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
        const queryObj = new WAUSync_1.USyncQuery()
            .withContext('message')
            .withDeviceProtocol();
        for (const jid of toFetch) {
            queryObj.withUser(new WAUSync_1.USyncUser().withId(jid));
        }
        const result = await sock.executeUSyncQuery(queryObj);
        if (result) {
            const extracted = (0, Utils_1.extractDeviceJids)(result === null || result === void 0 ? void 0 : result.list, authState.creds.me.id, ignoreZeroDevices);
            const deviceMap = {};
            for (const item of extracted) {
                deviceMap[item.user] = deviceMap[item.user] || [];
                deviceMap[item.user].push(item);
                deviceResults.push(item);
            }
            for (const key in deviceMap) {
                userDevicesCache.set(key, deviceMap[key]);
            }
        }
        return deviceResults;
    };
    const assertSessions = async (jids, force) => {
        let didFetchNewSession = false;
        let jidsRequiringFetch = [];
        if (force) {
            jidsRequiringFetch = jids;
        }
        else {
            const addrs = jids.map(jid => (signalRepository
                .jidToSignalProtocolAddress(jid)));
            const sessions = await authState.keys.get('session', addrs);
            for (const jid of jids) {
                const signalId = signalRepository
                    .jidToSignalProtocolAddress(jid);
                if (!sessions[signalId]) {
                    jidsRequiringFetch.push(jid);
                }
            }
        }
        if (jidsRequiringFetch.length) {
            logger.debug({ jidsRequiringFetch }, 'fetching sessions');
            const result = await query({
                tag: 'iq',
                attrs: {
                    xmlns: 'encrypt',
                    type: 'get',
                    to: WABinary_1.S_WHATSAPP_NET,
                },
                content: [
                    {
                        tag: 'key',
                        attrs: {},
                        content: jidsRequiringFetch.map(jid => ({
                            tag: 'user',
                            attrs: { jid },
                        }))
                    }
                ]
            });
            await (0, Utils_1.parseAndInjectE2ESessions)(result, signalRepository);
            didFetchNewSession = true;
        }
        return didFetchNewSession;
    };
    const sendPeerDataOperationMessage = async (pdoMessage) => {
        var _a;
        // TODO: for later, abstract the logic to send a Peer Message instead of just PDO - useful for App State Key Resync with phone
        if (!((_a = authState.creds.me) === null || _a === void 0 ? void 0 : _a.id)) {
            throw new boom_1.Boom('Not authenticated');
        }
        const protocolMessage = {
            protocolMessage: {
                peerDataOperationRequestMessage: pdoMessage,
                type: WAProto_1.proto.Message.ProtocolMessage.Type.PEER_DATA_OPERATION_REQUEST_MESSAGE
            }
        };
        const meJid = (0, WABinary_1.jidNormalizedUser)(authState.creds.me.id);
        const msgId = await relayMessage(meJid, protocolMessage, {
            additionalAttributes: {
                category: 'peer',
                // eslint-disable-next-line camelcase
                push_priority: 'high_force',
            },
        });
        return msgId;
    };
    const createParticipantNodes = async (jids, message, extraAttrs) => {
        const patched = await patchMessageBeforeSending(message, jids);
        const bytes = (0, Utils_1.encodeWAMessage)(patched);
        let shouldIncludeDeviceIdentity = false;
        const nodes = await Promise.all(jids.map(async (jid) => {
            const { type, ciphertext } = await signalRepository
                .encryptMessage({ jid, data: bytes });
            if (type === 'pkmsg') {
                shouldIncludeDeviceIdentity = true;
            }
            const node = {
                tag: 'to',
                attrs: { jid },
                content: [{
                        tag: 'enc',
                        attrs: {
                            v: '2',
                            type,
                            ...extraAttrs || {}
                        },
                        content: ciphertext
                    }]
            };
            return node;
        }));
        return { nodes, shouldIncludeDeviceIdentity };
    };
    const relayMessage = async (jid, message, { messageId: msgId, participant, additionalAttributes, additionalNodes, useUserDevicesCache, useCachedGroupMetadata, statusJidList } = {}) => {
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
        const destinationJid = (!isStatus)
            ? (0, WABinary_1.jidEncode)(user, isLid ? 'lid' : isGroup ? 'g.us' : 's.whatsapp.net')
            : statusJid;
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
            if (!isGroup && !isStatus) {
                additionalAttributes = { ...additionalAttributes, 'device_fanout': 'false' };
            }
            const { user, device } = (0, WABinary_1.jidDecode)(participant.jid);
            devices.push({ user, device });
        }
        await authState.keys.transaction(async () => {
            var _a, _b, _c, _d, _e;
            const mediaType = getMediaType(message);
            if (mediaType) {
                extraAttrs['mediatype'] = mediaType;
            }
            if ((_a = (0, Utils_1.normalizeMessageContent)(message)) === null || _a === void 0 ? void 0 : _a.pinInChatMessage) {
                extraAttrs['decrypt-fail'] = 'hide';
            }
            if (isGroup || isStatus) {
                const [groupData, senderKeyMap] = await Promise.all([
                    (async () => {
                        let groupData = useCachedGroupMetadata && cachedGroupMetadata ? await cachedGroupMetadata(jid) : undefined;
                        if (groupData && Array.isArray(groupData === null || groupData === void 0 ? void 0 : groupData.participants)) {
                            logger.trace({ jid, participants: groupData.participants.length }, 'using cached group metadata');
                        }
                        else if (!isStatus) {
                            groupData = await groupMetadata(jid);
                        }
                        return groupData;
                    })(),
                    (async () => {
                        if (!participant && !isStatus) {
                            const result = await authState.keys.get('sender-key-memory', [jid]);
                            return result[jid] || {};
                        }
                        return {};
                    })()
                ]);
                if (!participant) {
                    const participantsList = (groupData && !isStatus) ? groupData.participants.map(p => p.id) : [];
                    if (isStatus && statusJidList) {
                        participantsList.push(...statusJidList);
                    }
                    const additionalDevices = await getUSyncDevices(participantsList, !!useUserDevicesCache, false);
                    devices.push(...additionalDevices);
                }
                const patched = await patchMessageBeforeSending(message, devices.map(d => (0, WABinary_1.jidEncode)(d.user, isLid ? 'lid' : 's.whatsapp.net', d.device)));
                const bytes = (0, Utils_1.encodeWAMessage)(patched);
                const { ciphertext, senderKeyDistributionMessage } = await signalRepository.encryptGroupMessage({
                    group: destinationJid,
                    data: bytes,
                    meId,
                });
                const senderKeyJids = [];
                // ensure a connection is established with every device
                for (const { user, device } of devices) {
                    const jid = (0, WABinary_1.jidEncode)(user, isLid ? 'lid' : 's.whatsapp.net', device);
                    if (!senderKeyMap[jid] || !!participant) {
                        senderKeyJids.push(jid);
                        // store that this person has had the sender keys sent to them
                        senderKeyMap[jid] = true;
                    }
                }
                // if there are some participants with whom the session has not been established
                // resend the sender key if necessary
                if (senderKeyJids.length) {
                    logger.debug({ senderKeyJids }, 'sending new sender key');
                    const senderKeyMsg = {
                        senderKeyDistributionMessage: {
                            axolotlSenderKeyDistributionMessage: senderKeyDistributionMessage,
                            groupId: destinationJid
                        }
                    };
                    await assertSessions(senderKeyJids, false);
                    const result = await createParticipantNodes(senderKeyJids, senderKeyMsg, extraAttrs);
                    shouldIncludeDeviceIdentity = shouldIncludeDeviceIdentity || result.shouldIncludeDeviceIdentity;
                    participants.push(...result.nodes);
                }
                binaryNodeContent.push({
                    tag: 'enc',
                    attrs: { v: '2', type: 'skmsg' },
                    content: ciphertext
                });
                await authState.keys.set({ 'sender-key-memory': { [jid]: senderKeyMap } });
            }
            else {
                const { user: meUser } = (0, WABinary_1.jidDecode)(meId);
                if (!participant) {
                    devices.push({ user });
                    if (user !== meUser) {
                        devices.push({ user: meUser });
                    }
                    if ((additionalAttributes === null || additionalAttributes === void 0 ? void 0 : additionalAttributes['category']) !== 'peer') {
                        const additionalDevices = await getUSyncDevices([meId, jid], !!useUserDevicesCache, true);
                        devices.push(...additionalDevices);
                    }
                }
                const allJids = [];
                const meJids = [];
                const otherJids = [];
                for (const { user, device } of devices) {
                    const isMe = user === meUser;
                    const jid = (0, WABinary_1.jidEncode)(isMe && isLid ? ((_c = (_b = authState.creds) === null || _b === void 0 ? void 0 : _b.me) === null || _c === void 0 ? void 0 : _c.lid.split(':')[0]) || user : user, isLid ? 'lid' : 's.whatsapp.net', device);
                    if (isMe) {
                        meJids.push(jid);
                    }
                    else {
                        otherJids.push(jid);
                    }
                    allJids.push(jid);
                }
                await assertSessions(allJids, false);
                const [{ nodes: meNodes, shouldIncludeDeviceIdentity: s1 }, { nodes: otherNodes, shouldIncludeDeviceIdentity: s2 }] = await Promise.all([
                    createParticipantNodes(meJids, meMsg, extraAttrs),
                    createParticipantNodes(otherJids, message, extraAttrs)
                ]);
                participants.push(...meNodes);
                participants.push(...otherNodes);
                shouldIncludeDeviceIdentity = shouldIncludeDeviceIdentity || s1 || s2;
            }
            if (participants.length) {
                if ((additionalAttributes === null || additionalAttributes === void 0 ? void 0 : additionalAttributes['category']) === 'peer') {
                    const peerNode = (_e = (_d = participants[0]) === null || _d === void 0 ? void 0 : _d.content) === null || _e === void 0 ? void 0 : _e[0];
                    if (peerNode) {
                        binaryNodeContent.push(peerNode); // push only enc
                    }
                }
                else {
                    binaryNodeContent.push({
                        tag: 'participants',
                        attrs: {},
                        content: participants
                    });
                }
            }
            const stanza = {
                tag: 'message',
                attrs: {
                    id: msgId,
                    type: getMessageType(message),
                    ...(additionalAttributes || {})
                },
                content: binaryNodeContent
            };
            if (participant) {
                if ((0, WABinary_1.isJidGroup)(destinationJid)) {
                    stanza.attrs.to = destinationJid;
                    stanza.attrs.participant = participant.jid;
                }
                else if ((0, WABinary_1.areJidsSameUser)(participant.jid, meId)) {
                    stanza.attrs.to = participant.jid;
                    stanza.attrs.recipient = destinationJid;
                }
                else {
                    stanza.attrs.to = participant.jid;
                }
            }
            else {
                stanza.attrs.to = destinationJid;
            }
            if (shouldIncludeDeviceIdentity) {
                stanza.content.push({
                    tag: 'device-identity',
                    attrs: {},
                    content: (0, Utils_1.encodeSignedDeviceIdentity)(authState.creds.account, true)
                });
                logger.debug({ jid }, 'adding device identity');
            }
            if (additionalNodes && additionalNodes.length > 0) {
                stanza.content.push(...additionalNodes);
            }
            logger.debug({ msgId }, `sending message to ${participants.length} devices`);
            await sendNode(stanza);
        });
        return msgId;
    };
    const getMessageType = (message) => {
        if (message.pollCreationMessage || message.pollCreationMessageV2 || message.pollCreationMessageV3) {
            return 'poll';
        }
        return 'text';
    };
    const getMediaType = (message) => {
        if (message.imageMessage) {
            return 'image';
        }
        else if (message.videoMessage) {
            return message.videoMessage.gifPlayback ? 'gif' : 'video';
        }
        else if (message.audioMessage) {
            return message.audioMessage.ptt ? 'ptt' : 'audio';
        }
        else if (message.contactMessage) {
            return 'vcard';
        }
        else if (message.documentMessage) {
            return 'document';
        }
        else if (message.contactsArrayMessage) {
            return 'contact_array';
        }
        else if (message.liveLocationMessage) {
            return 'livelocation';
        }
        else if (message.stickerMessage) {
            return 'sticker';
        }
        else if (message.listMessage) {
            return 'list';
        }
        else if (message.listResponseMessage) {
            return 'list_response';
        }
        else if (message.buttonsResponseMessage) {
            return 'buttons_response';
        }
        else if (message.orderMessage) {
            return 'order';
        }
        else if (message.productMessage) {
            return 'product';
        }
        else if (message.interactiveResponseMessage) {
            return 'native_flow_response';
        }
        else if (message.groupInviteMessage) {
            return 'url';
        }
    };
    const getPrivacyTokens = async (jids) => {
        const t = (0, Utils_1.unixTimestampSeconds)().toString();
        const result = await query({
            tag: 'iq',
            attrs: {
                to: WABinary_1.S_WHATSAPP_NET,
                type: 'set',
                xmlns: 'privacy'
            },
            content: [
                {
                    tag: 'tokens',
                    attrs: {},
                    content: jids.map(jid => ({
                        tag: 'token',
                        attrs: {
                            jid: (0, WABinary_1.jidNormalizedUser)(jid),
                            t,
                            type: 'trusted_contact'
                        }
                    }))
                }
            ]
        });
        return result;
    };
    const waUploadToServer = (0, Utils_1.getWAUploadToServer)(config, refreshMediaConn);
    const waitForMsgMediaUpdate = (0, Utils_1.bindWaitForEvent)(ev, 'messages.media-update');

    // =========================================================================
    // Noile funcționalități adăugate:
    // =========================================================================

    // 1. Trimiterea reacțiilor la mesaje
    const sendReaction = async (jid, messageKey, emoji) => {
        const reactionMessage = {
            reactionMessage: {
                key: messageKey,
                text: emoji
            }
        };
        logger.debug({ jid, messageKey, emoji }, 'sending reaction');
        await relayMessage(jid, reactionMessage, {});
    };

    // 2. Trimiterea unui mesaj text cu menționări
    const sendTextWithMentions = async (jid, text, mentionedJids) => {
        const message = {
            extendedTextMessage: {
                text: text,
                contextInfo: {
                    mentionedJid: mentionedJids
                }
            }
        };
        logger.debug({ jid, mentionedJids }, 'sending text with mentions');
        await relayMessage(jid, message, {});
    };

    // 3. Trimiterea unui mesaj de sondaj
    const sendPollMessage = async (jid, question, optionsArr) => {
        const pollMessage = {
            pollCreationMessage: {
                name: question,
                options: optionsArr.map(opt => ({ name: opt })),
                selectableOptionsCount: optionsArr.length
            }
        };
        logger.debug({ jid, question, options: optionsArr }, 'sending poll message');
        await relayMessage(jid, pollMessage, {});
    };

    // 4. Trimiterea unui mesaj interactiv (listă cu butoane)
    const sendInteractiveMessage = async (jid, title, buttonText, buttons) => {
        const interactiveMessage = {
            listMessage: {
                title: title,
                buttonText: buttonText,
                sections: [{
                    rows: buttons.map(btn => ({ title: btn }))
                }]
            }
        };
        logger.debug({ jid, title, buttonText, buttons }, 'sending interactive message');
        await relayMessage(jid, interactiveMessage, {});
    };

    // 5. Trimiterea unui mesaj media (de exemplu, imagine)
    const sendMediaMessage = async (jid, mediaBuffer, mimetype, caption = '') => {
        const message = {
            imageMessage: {
                mimetype: mimetype,
                caption: caption,
                jpegThumbnail: mediaBuffer
            }
        };
        logger.debug({ jid, mimetype, caption }, 'sending media message');
        await relayMessage(jid, message, {});
    };

    // 6. Ștergerea unui mesaj
    const deleteMessage = async (jid, messageKey) => {
        const deleteMsg = {
            protocolMessage: {
                key: messageKey,
                type: 'REVOKE'
            }
        };
        logger.debug({ jid, messageKey }, 'deleting message');
        await relayMessage(jid, deleteMsg, {});
    };

    // 7. Editarea unui mesaj
    const editMessage = async (jid, messageKey, newText) => {
        const editMsg = {
            extendedTextMessage: {
                text: newText,
                contextInfo: {
                    editedMessageKey: messageKey
                }
            }
        };
        logger.debug({ jid, messageKey, newText }, 'editing message');
        await relayMessage(jid, editMsg, {});
    };

    // =========================================================================
    // Final – Returnarea socket-ului extins cu noile funcționalități
    // =========================================================================
    return {
        ...sock,
        getPrivacyTokens,
        assertSessions,
        relayMessage,
        sendReceipt,
        sendReceipts,
        readMessages,
        refreshMediaConn,
        waUploadToServer,
        fetchPrivacySettings,
        sendPeerDataOperationMessage,
        createParticipantNodes,
        getUSyncDevices,
        updateMediaMessage,
        sendMessage,
        // Funcționalităților noi:
        sendReaction,
        sendTextWithMentions,
        sendPollMessage,
        sendInteractiveMessage,
        sendMediaMessage,
        deleteMessage,
        editMessage
    };
};
exports.makeMessagesSocket = makeMessagesSocket;
