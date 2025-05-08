"use strict";

const LRU = require("lru-cache");
const boom = require("@hapi/boom");
const WAProto = require("../../WAProto");
const Defaults = require("../Defaults");
const Utils = require("../Utils");
const linkPreview = require("../Utils/link-preview");
const WABinary = require("../WABinary");
const WAUSync = require("../WAUSync");
const groups = require("./groups");

/**
 * Functie helper pentru validarea mesajului.
 * Aruncă eroare dacă conținutul nu este valid.
 */
const validateMessageContent = (content) => {
  if (!content || typeof content !== "object") {
    throw new Error("Conținutul mesajului trebuie să fie un obiect valid.");
  }
  // Alte validări pot fi adăugate aici
  return content;
};

/**
 * Sistem de plugin-uri. Fiecare plugin poate implementa:
 * - beforeSend(message, jid, options): pentru a modifica mesajul înainte de trimitere.
 * - afterSend(fullMsg): după trimiterea mesajului.
 */
const runPluginsBeforeSend = async (plugins, message, jid, options) => {
  let modifiedMessage = message;
  for (const plugin of plugins) {
    if (plugin && typeof plugin.beforeSend === "function") {
      modifiedMessage = await plugin.beforeSend(modifiedMessage, jid, options);
    }
  }
  return modifiedMessage;
};

const runPluginsAfterSend = async (plugins, fullMsg) => {
  for (const plugin of plugins) {
    if (plugin && typeof plugin.afterSend === "function") {
      await plugin.afterSend(fullMsg);
    }
  }
};

/**
 * Funcție de auto-update API:
 * La fiecare apel verifică dacă a expirat intervalul de update;
 * dacă da, se face un query către endpoint-ul WhatsApp pentru a actualiza setările.
 */
const createAPIUpdater = (config, query, logger) => {
  let lastCheck = 0;
  const UPDATE_INTERVAL = 60 * 60 * 1000; // 1 oră

  return async () => {
    const now = Date.now();
    if (now - lastCheck > UPDATE_INTERVAL) {
      lastCheck = now;
      logger.info("Verific update API...");
      try {
        // Exemplu de query pentru actualizare (endpoint-ul poate fi ajustat)
        const result = await query({
          tag: "iq",
          attrs: {
            type: "get",
            xmlns: "w:api",
            to: WABinary.S_WHATSAPP_NET
          },
          content: [{ tag: "update", attrs: {} }]
        });
        // Exemplu: actualizează setările interne dacă se găsesc endpoint-uri noi
        if (result && result.content) {
          config.apiSettings = result.content;
          logger.info("API updatat cu setările noi:", result.content);
        }
      } catch (error) {
        logger.warn("Nu s-a putut actualiza API-ul, folosim fallback-ul.");
      }
    }
  };
};

const makeMessagesSocket = (config) => {
  const {
    logger,
    linkPreviewImageThumbnailWidth,
    generateHighQualityLinkPreview,
    options: axiosOptions,
    patchMessageBeforeSending,
    cachedGroupMetadata,
    plugins = [] // Plugin-urile pot fi adăugate prin configurare
  } = config;

  const sock = groups.makeGroupsSocket(config);
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

  // Initialize LRU cache pentru dispozitivele user
  const userDevicesCache = config.userDevicesCache || new LRU({
    max: 500,
    ttl: Defaults.DEFAULT_CACHE_TTLS.USER_DEVICES * 1000 // TTL în milisecunde
  });

  // Inițializarea API updater pentru compatibilitate
  const checkAndUpdateAPI = createAPIUpdater(config, query, logger);

  let mediaConn;
  const refreshMediaConn = async (forceGet = false) => {
    try {
      const media = await mediaConn;
      if (!media || forceGet || (Date.now() - media.fetchDate.getTime()) > media.ttl * 1000) {
        mediaConn = (async () => {
          await checkAndUpdateAPI(); // Asigură-te că API-ul e actualizat
          const result = await query({
            tag: "iq",
            attrs: {
              type: "set",
              xmlns: "w:m",
              to: WABinary.S_WHATSAPP_NET,
            },
            content: [{ tag: "media_conn", attrs: {} }]
          });
          const mediaConnNode = WABinary.getBinaryNodeChild(result, "media_conn");
          const node = {
            hosts: WABinary.getBinaryNodeChildren(mediaConnNode, "host").map(({ attrs }) => ({
              hostname: attrs.hostname,
              maxContentLengthBytes: +attrs.maxContentLengthBytes,
            })),
            auth: mediaConnNode.attrs.auth,
            ttl: +mediaConnNode.attrs.ttl,
            fetchDate: new Date()
          };
          logger.info("Media connection actualizată.");
          return node;
        })();
      }
      return mediaConn;
    } catch (error) {
      logger.error("Eroare la refreshMediaConn:", error);
      throw error;
    }
  };

  const sendReceipt = async (jid, participant, messageIds, type) => {
    try {
      validateMessageContent({ receipt: messageIds });
      const node = {
        tag: "receipt",
        attrs: { id: messageIds[0] }
      };
      const isReadReceipt = type === "read" || type === "read-self";
      if (isReadReceipt) node.attrs.t = Utils.unixTimestampSeconds().toString();
      if (type === "sender" && WABinary.isJidUser(jid)) {
        node.attrs.recipient = jid;
        node.attrs.to = participant;
      } else {
        node.attrs.to = jid;
        if (participant) node.attrs.participant = participant;
      }
      if (type) node.attrs.type = type;
      const remainingMessageIds = messageIds.slice(1);
      if (remainingMessageIds.length) {
        node.content = [{
          tag: "list",
          attrs: {},
          content: remainingMessageIds.map(id => ({ tag: "item", attrs: { id } }))
        }];
      }
      logger.debug({ attrs: node.attrs, messageIds }, "Trimit receipt pentru mesaje.");
      await sendNode(node);
    } catch (error) {
      logger.error("Eroare la trimiterea receipt:", error);
      throw error;
    }
  };

  const sendReceipts = async (keys, type) => {
    const recps = Utils.aggregateMessageKeysNotFromMe(keys);
    await Promise.all(
      recps.map(({ jid, participant, messageIds }) => sendReceipt(jid, participant, messageIds, type))
    );
  };

  const readMessages = async (keys) => {
    try {
      const privacySettings = await fetchPrivacySettings();
      const readType = privacySettings.readreceipts === "all" ? "read" : "read-self";
      await sendReceipts(keys, readType);
    } catch (error) {
      logger.error("Eroare la readMessages:", error);
      throw error;
    }
  };

  const getUSyncDevices = async (jids, useCache, ignoreZeroDevices) => {
    const deviceResults = [];
    if (!useCache) logger.debug("Cache dezactivat pentru devices.");
    const toFetch = [];
    jids = Array.from(new Set(jids));
    for (let jid of jids) {
      const user = WABinary.jidDecode(jid)?.user;
      jid = WABinary.jidNormalizedUser(jid);
      if (useCache) {
        const devices = userDevicesCache.get(user);
        if (devices) {
          deviceResults.push(...devices);
          logger.trace({ user }, "Folosim cache pentru devices.");
        } else toFetch.push(jid);
      } else {
        toFetch.push(jid);
      }
    }
    if (!toFetch.length) return deviceResults;
    const queryObj = new WAUSync.USyncQuery()
      .withContext("message")
      .withDeviceProtocol();
    for (const jid of toFetch) {
      queryObj.withUser(new WAUSync.USyncUser().withId(jid));
    }
    try {
      const result = await sock.executeUSyncQuery(queryObj);
      if (result) {
        const extracted = Utils.extractDeviceJids(result?.list, authState.creds.me.id, ignoreZeroDevices);
        const deviceMap = {};
        extracted.forEach(item => {
          deviceMap[item.user] = deviceMap[item.user] || [];
          deviceMap[item.user].push(item);
          deviceResults.push(item);
        });
        Object.keys(deviceMap).forEach(key => userDevicesCache.set(key, deviceMap[key]));
      }
    } catch (error) {
      logger.error("Eroare la getUSyncDevices:", error);
      throw error;
    }
    return deviceResults;
  };

  const assertSessions = async (jids, force) => {
    let didFetchNewSession = false;
    let jidsRequiringFetch = [];
    if (force) {
      jidsRequiringFetch = jids;
    } else {
      const addrs = jids.map(jid => signalRepository.jidToSignalProtocolAddress(jid));
      const sessions = await authState.keys.get("session", addrs);
      for (const jid of jids) {
        const signalId = signalRepository.jidToSignalProtocolAddress(jid);
        if (!sessions[signalId]) jidsRequiringFetch.push(jid);
      }
    }
    if (jidsRequiringFetch.length) {
      logger.debug({ jidsRequiringFetch }, "Se obțin sesiuni lipsă.");
      try {
        const result = await query({
          tag: "iq",
          attrs: {
            xmlns: "encrypt",
            type: "get",
            to: WABinary.S_WHATSAPP_NET,
          },
          content: [{
            tag: "key",
            attrs: {},
            content: jidsRequiringFetch.map(jid => ({ tag: "user", attrs: { jid } }))
          }]
        });
        await Utils.parseAndInjectE2ESessions(result, signalRepository);
        didFetchNewSession = true;
      } catch (error) {
        logger.error("Eroare la assertSessions:", error);
        throw error;
      }
    }
    return didFetchNewSession;
  };

  const sendPeerDataOperationMessage = async (pdoMessage) => {
    if (!authState.creds.me?.id)
      throw new boom("Not authenticated");
    const protocolMessage = {
      protocolMessage: {
        peerDataOperationRequestMessage: pdoMessage,
        type: WAProto.proto.Message.ProtocolMessage.Type.PEER_DATA_OPERATION_REQUEST_MESSAGE
      }
    };
    const meJid = WABinary.jidNormalizedUser(authState.creds.me.id);
    try {
      const msgId = await relayMessage(meJid, protocolMessage, {
        additionalAttributes: { category: "peer", push_priority: "high_force" },
      });
      return msgId;
    } catch (error) {
      logger.error("Eroare la sendPeerDataOperationMessage:", error);
      throw error;
    }
  };

  const createParticipantNodes = async (jids, message, extraAttrs) => {
    try {
      const patched = await patchMessageBeforeSending(message, jids);
      const bytes = Utils.encodeWAMessage(patched);
      let shouldIncludeDeviceIdentity = false;
      const nodes = await Promise.all(jids.map(async (jid) => {
        const { type, ciphertext } = await signalRepository.encryptMessage({
          jid, data: bytes
        });
        if (type === "pkmsg") shouldIncludeDeviceIdentity = true;
        return {
          tag: "to",
          attrs: { jid },
          content: [{
            tag: "enc",
            attrs: { v: "2", type, ...extraAttrs || {} },
            content: ciphertext
          }]
        };
      }));
      return { nodes, shouldIncludeDeviceIdentity };
    } catch (error) {
      logger.error("Eroare la createParticipantNodes:", error);
      throw error;
    }
  };

  const relayMessage = async (
    jid,
    message,
    { messageId, participant, additionalAttributes, additionalNodes, useUserDevicesCache, useCachedGroupMetadata, statusJidList } = {}
  ) => {
    try {
      const meId = authState.creds.me.id;
      let shouldIncludeDeviceIdentity = false;
      const { user, server } = WABinary.jidDecode(jid);
      const statusJid = "status@broadcast";
      const isGroup = server === "g.us";
      const isStatus = jid === statusJid;
      const isLid = server === "lid";
      messageId = messageId || Utils.generateMessageIDV2(sock.user?.id);
      useUserDevicesCache = useUserDevicesCache !== false;
      useCachedGroupMetadata = useCachedGroupMetadata !== false && !isStatus;
      const participants = [];
      const destinationJid = !isStatus
        ? WABinary.jidEncode(user, isLid ? "lid" : isGroup ? "g.us" : "s.whatsapp.net")
        : statusJid;
      const binaryNodeContent = [];
      const devices = [];
      const meMsg = { deviceSentMessage: { destinationJid, message } };
      const extraAttrs = {};

      if (participant) {
        if (!isGroup && !isStatus)
          additionalAttributes = { ...(additionalAttributes || {}), device_fanout: "false" };
        const { user, device } = WABinary.jidDecode(participant.jid);
        devices.push({ user, device });
      }

      await authState.keys.transaction(async () => {
        const mediaType = getMediaType(message);
        if (mediaType) extraAttrs["mediatype"] = mediaType;
        if (Utils.normalizeMessageContent(message)?.pinInChatMessage)
          extraAttrs["decrypt-fail"] = "hide";

        if (isGroup || isStatus) {
          const [groupData, senderKeyMap] = await Promise.all([
            (async () => {
              let groupData = useCachedGroupMetadata && cachedGroupMetadata ? await cachedGroupMetadata(jid) : undefined;
              if (groupData && Array.isArray(groupData?.participants)) {
                logger.trace({ jid, participants: groupData.participants.length }, "Folosim metadata pentru grup din cache.");
              } else if (!isStatus) {
                groupData = await groupMetadata(jid);
              }
              return groupData;
            })(),
            (async () => {
              if (!participant && !isStatus) {
                const result = await authState.keys.get("sender-key-memory", [jid]);
                return result[jid] || {};
              }
              return {};
            })()
          ]);
          if (!participant) {
            const participantsList = groupData && !isStatus
              ? groupData.participants.map(p => p.id)
              : [];
            if (isStatus && statusJidList) participantsList.push(...statusJidList);
            const additionalDevices = await getUSyncDevices(participantsList, !!useUserDevicesCache, false);
            devices.push(...additionalDevices);
          }
          const patchedGroupMsg = await patchMessageBeforeSending(
            message,
            devices.map(d => WABinary.jidEncode(d.user, isLid ? "lid" : "s.whatsapp.net", d.device))
          );
          const bytes = Utils.encodeWAMessage(patchedGroupMsg);
          const { ciphertext, senderKeyDistributionMessage } = await signalRepository.encryptGroupMessage({
            group: destinationJid,
            data: bytes,
            meId,
          });
          const senderKeyJids = [];
          for (const { user, device } of devices) {
            const entryJid = WABinary.jidEncode(user, isLid ? "lid" : "s.whatsapp.net", device);
            if (!senderKeyMap[entryJid] || !!participant) {
              senderKeyJids.push(entryJid);
              senderKeyMap[entryJid] = true;
            }
          }
          if (senderKeyJids.length) {
            logger.debug({ senderKeyJids }, "Trimit noul sender key.");
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
            tag: "enc",
            attrs: { v: "2", type: "skmsg" },
            content: ciphertext
          });
          await authState.keys.set({ "sender-key-memory": { [jid]: senderKeyMap } });
        } else {
          const { user: meUser } = WABinary.jidDecode(meId);
          if (!participant) {
            devices.push({ user });
            if (user !== meUser) devices.push({ user: meUser });
            if ((additionalAttributes?.category) !== "peer") {
              const additionalDevices = await getUSyncDevices([meId, jid], !!useUserDevicesCache, true);
              devices.push(...additionalDevices);
            }
          }
          const allJids = [];
          const meJids = [];
          const otherJids = [];
          for (const { user, device } of devices) {
            const isMe = user === meUser;
            const entryJid = WABinary.jidEncode(
              isMe && isLid ? (authState.creds?.me?.lid.split(":")[0] || user) : user,
              isLid ? "lid" : "s.whatsapp.net",
              device
            );
            if (isMe) meJids.push(entryJid); else otherJids.push(entryJid);
            allJids.push(entryJid);
          }
          await assertSessions(allJids, false);
          const [{ nodes: meNodes, shouldIncludeDeviceIdentity: s1 }, { nodes: otherNodes, shouldIncludeDeviceIdentity: s2 }] =
            await Promise.all([
              createParticipantNodes(meJids, meMsg, extraAttrs),
              createParticipantNodes(otherJids, message, extraAttrs)
            ]);
          participants.push(...meNodes, ...otherNodes);
          shouldIncludeDeviceIdentity = shouldIncludeDeviceIdentity || s1 || s2;
        }
        if (participants.length) {
          if (additionalAttributes?.category === "peer") {
            const peerNode = participants[0]?.content?.[0];
            if (peerNode) binaryNodeContent.push(peerNode);
          } else {
            binaryNodeContent.push({ tag: "participants", attrs: {}, content: participants });
          }
        }
        const stanza = {
          tag: "message",
          attrs: {
            id: messageId,
            type: getMessageType(message),
            ...additionalAttributes
          },
          content: binaryNodeContent
        };
        if (participant) {
          if (WABinary.isJidGroup(destinationJid)) {
            stanza.attrs.to = destinationJid;
            stanza.attrs.participant = participant.jid;
          } else if (WABinary.areJidsSameUser(participant.jid, meId)) {
            stanza.attrs.to = participant.jid;
            stanza.attrs.recipient = destinationJid;
          } else {
            stanza.attrs.to = participant.jid;
          }
        } else {
          stanza.attrs.to = destinationJid;
        }
        if (shouldIncludeDeviceIdentity) {
          stanza.content.push({
            tag: "device-identity",
            attrs: {},
            content: Utils.encodeSignedDeviceIdentity(authState.creds.account, true)
          });
          logger.debug({ jid }, "Adaug device-identity.");
        }
        if (additionalNodes && additionalNodes.length > 0) {
          stanza.content.push(...additionalNodes);
        }
        logger.debug({ messageId }, `Trimit mesaj către ${participants.length} devices.`);
        await sendNode(stanza);
      });
      return messageId;
    } catch (error) {
      logger.error("Eroare la relayMessage:", error);
      throw error;
    }
  };

  const getMessageType = (message) => {
    if (message.pollCreationMessage || message.pollCreationMessageV2 || message.pollCreationMessageV3) return "poll";
    return "text";
  };

  const getMediaType = (message) => {
    if (message.imageMessage) return "image";
    if (message.videoMessage) return message.videoMessage.gifPlayback ? "gif" : "video";
    if (message.audioMessage) return message.audioMessage.ptt ? "ptt" : "audio";
    if (message.contactMessage) return "vcard";
    if (message.documentMessage) return "document";
    if (message.contactsArrayMessage) return "contact_array";
    if (message.liveLocationMessage) return "livelocation";
    if (message.stickerMessage) return "sticker";
    if (message.listMessage) return "list";
    if (message.listResponseMessage) return "list_response";
    if (message.buttonsResponseMessage) return "buttons_response";
    if (message.orderMessage) return "order";
    if (message.productMessage) return "product";
    if (message.interactiveResponseMessage) return "native_flow_response";
    if (message.groupInviteMessage) return "url";
  };

  const getPrivacyTokens = async (jids) => {
    try {
      const t = Utils.unixTimestampSeconds().toString();
      const result = await query({
        tag: "iq",
        attrs: { to: WABinary.S_WHATSAPP_NET, type: "set", xmlns: "privacy" },
        content: [{
          tag: "tokens",
          attrs: {},
          content: jids.map(jid => ({
            tag: "token",
            attrs: { jid: WABinary.jidNormalizedUser(jid), t, type: "trusted_contact" }
          }))
        }]
      });
      return result;
    } catch (error) {
      logger.error("Eroare la getPrivacyTokens:", error);
      throw error;
    }
  };

  const waUploadToServer = Utils.getWAUploadToServer(config, refreshMediaConn);
  const waitForMsgMediaUpdate = Utils.bindWaitForEvent(ev, "messages.media-update");

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
    updateMediaMessage: async (message) => {
      const content = Utils.assertMediaContent(message.message);
      const mediaKey = content.mediaKey;
      const meId = authState.creds.me.id;
      try {
        const node = await Utils.encryptMediaRetryRequest(message.key, mediaKey, meId);
        let error;
        await Promise.all([
          sendNode(node),
          waitForMsgMediaUpdate(async (update) => {
            const result = update.find(c => c.key.id === message.key.id);
            if (result) {
              if (result.error) {
                error = result.error;
              } else {
                try {
                  const media = await Utils.decryptMediaRetryData(result.media, mediaKey, result.key.id);
                  if (media.result !== WAProto.proto.MediaRetryNotification.ResultType.SUCCESS) {
                    const resultStr = WAProto.proto.MediaRetryNotification.ResultType[media.result];
                    throw new boom(`Media re-upload failed by device (${resultStr})`, { data: media, statusCode: Utils.getStatusCodeForMediaRetry(media.result) || 404 });
                  }
                  content.directPath = media.directPath;
                  content.url = Utils.getUrlFromDirectPath(content.directPath);
                  logger.debug({ directPath: media.directPath, key: result.key }, "Media update successful.");
                } catch (err) {
                  error = err;
                }
              }
              return true;
            }
          })
        ]);
        if (error) throw error;
        ev.emit("messages.update", [{ key: message.key, update: { message: message.message } }]);
        return message;
      } catch (error) {
        logger.error("Eroare la updateMediaMessage:", error);
        throw error;
      }
    },
    sendMessage: async (jid, content, options = {}) => {
      try {
        const userJid = authState.creds.me.id;
        // Dacă mesajul este despre setarea dispariției mesajelor într-un grup.
        if (
          typeof content === "object" &&
          "disappearingMessagesInChat" in content &&
          typeof content["disappearingMessagesInChat"] !== "undefined" &&
          WABinary.isJidGroup(jid)
        ) {
          const { disappearingMessagesInChat } = content;
          const value = typeof disappearingMessagesInChat === "boolean"
            ? (disappearingMessagesInChat ? Defaults.WA_DEFAULT_EPHEMERAL : 0)
            : disappearingMessagesInChat;
          await groupToggleEphemeral(jid, value);
        } else {
          // Validăm și rulăm plugin-urile beforeSend
          validateMessageContent(content);
          const processedContent = await runPluginsBeforeSend(plugins, content, jid, options);
          const fullMsg = await Utils.generateWAMessage(jid, processedContent, {
            logger,
            userJid,
            getUrlInfo: text => linkPreview.getUrlInfo(text, {
              thumbnailWidth: linkPreviewImageThumbnailWidth,
              fetchOpts: { timeout: 3000, ...axiosOptions || {} },
              logger,
              uploadImage: generateHighQualityLinkPreview ? waUploadToServer : undefined
            }),
            getProfilePicUrl: sock.profilePictureUrl,
            upload: waUploadToServer,
            mediaCache: config.mediaCache,
            options: config.options,
            messageId: Utils.generateMessageIDV2(sock.user?.id),
            ...options,
          });
          const isDeleteMsg = "delete" in content && !!content.delete;
          const isEditMsg = "edit" in content && !!content.edit;
          const isPinMsg = "pin" in content && !!content.pin;
          const isPollMessage = "poll" in content && !!content.poll;
          const additionalAttributes = {};
          const additionalNodes = [];
          if (isDeleteMsg) {
            additionalAttributes.edit = WABinary.isJidGroup(content.delete?.remoteJid) && !content.delete?.fromMe ? "8" : "7";
          } else if (isEditMsg) {
            additionalAttributes.edit = "1";
          } else if (isPinMsg) {
            additionalAttributes.edit = "2";
          } else if (isPollMessage) {
            additionalNodes.push({ tag: "meta", attrs: { polltype: "creation" } });
          }
          if ("cachedGroupMetadata" in options) {
            console.warn("cachedGroupMetadata in sendMessage is deprecated; use socket config instead.");
          }
          await relayMessage(jid, fullMsg.message, {
            messageId: fullMsg.key.id,
            useCachedGroupMetadata: options.useCachedGroupMetadata,
            additionalAttributes,
            statusJidList: options.statusJidList,
            additionalNodes
          });
          if (config.emitOwnEvents) {
            process.nextTick(() => {
              processingMutex.mutex(() => upsertMessage(fullMsg, "append"));
            });
          }
          // Rulăm plugin-urile afterSend
          await runPluginsAfterSend(plugins, fullMsg);
          return fullMsg;
        }
      } catch (error) {
        logger.error("Eroare la sendMessage:", error);
        throw error;
      }
    }
  };
};

module.exports = { makeMessagesSocket };
