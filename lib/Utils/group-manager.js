/**
 * Sistem avansat de gestionare a grupurilor pentru @borutowaileys/library
 * Acest modul oferă funcționalități avansate pentru administrarea și monitorizarea grupurilor
 */

class GroupManager {
  /**
   * Creează o nouă instanță pentru gestionarea grupurilor
   * @param {Object} sock Instanța socket-ului WhatsApp
   */
  constructor(sock) {
    this.sock = sock;
    this.groups = new Map();
    this.scheduledActions = new Map();
  }

  /**
   * Încarcă toate grupurile și datele lor
   * @returns {Promise<Map>} Map-ul cu informații despre grupuri
   */
  async loadGroups() {
    try {
      const result = await this.sock.groupFetchAllParticipating();
      for (const [id, info] of Object.entries(result)) {
        this.groups.set(id, info);
      }
      return this.groups;
    } catch (error) {
      console.error('Eroare la încărcarea grupurilor:', error);
      throw error;
    }
  }

  /**
   * Creează un grup nou cu opțiuni avansate
   * @param {string} name Numele grupului
   * @param {string[]} participants Lista de participanți (format jid)
   * @param {Object} options Opțiuni suplimentare
   * @returns {Promise<Object>} Informațiile grupului creat
   */
  async createGroup(name, participants, options = {}) {
    try {
      const result = await this.sock.groupCreate(name, participants);
      
      if (options.description) {
        await this.sock.groupUpdateDescription(result.id, options.description);
      }
      
      if (options.picture) {
        await this.sock.updateProfilePicture(result.id, options.picture);
      }
      
      if (options.restrict && result.id) {
        await this.sock.groupSettingUpdate(result.id, 'announcement');
      }
      
      await this.loadGroups();
      return result;
    } catch (error) {
      console.error('Eroare la crearea grupului:', error);
      throw error;
    }
  }

  /**
   * Monitorizează schimbările din grupuri
   * @param {Function} callback Funcția apelată la schimbări
   */
  async monitorGroupChanges(callback) {
    this.sock.ev.on('groups.update', async (updates) => {
      for (const update of updates) {
        const currentInfo = this.groups.get(update.id);
        if (currentInfo) {
          const updatedInfo = { ...currentInfo, ...update };
          this.groups.set(update.id, updatedInfo);
        }
        if (callback) callback('update', update);
      }
    });

    this.sock.ev.on('group-participants.update', async (update) => {
      const groupInfo = this.groups.get(update.id);
      if (groupInfo) {
        // Actualizăm lista de participanți
        await this.loadGroups();
      }
      if (callback) callback('participants', update);
    });

    this.sock.ev.on('groups.upsert', async (newGroups) => {
      for (const group of newGroups) {
        this.groups.set(group.id, group);
        if (callback) callback('new', group);
      }
    });

    this.sock.ev.on('groups.delete', async (deletions) => {
      for (const groupId of deletions) {
        this.groups.delete(groupId);
        if (callback) callback('delete', { id: groupId });
      }
    });
  }

  /**
   * Setează sau elimină rolul de admin pentru utilizatori
   * @param {string} groupId ID-ul grupului
   * @param {string[]} userIds Lista de utilizatori (format jid)
   * @param {boolean} demote True pentru a elimina drepturile de admin, False pentru a promova
   * @returns {Promise<Object>} Rezultatul operațiunii
   */
  async setGroupAdmins(groupId, userIds, demote = false) {
    try {
      const method = demote ? 'groupDemoteAdmin' : 'groupPromoteAdmin';
      return await this.sock[method](groupId, userIds);
    } catch (error) {
      console.error(`Eroare la ${demote ? 'retrogradarea' : 'promovarea'} adminilor:`, error);
      throw error;
    }
  }

  /**
   * Programează o acțiune pentru un grup la un moment specific
   * @param {string} groupId ID-ul grupului
   * @param {string} action Acțiunea de efectuat
   * @param {Date|number} time Momentul execuției (Date sau timestamp)
   * @param {Object} params Parametrii pentru acțiune
   * @returns {Promise<boolean>} True dacă acțiunea a fost programată, false altfel
   */
  async scheduleAction(groupId, action, time, params = {}) {
    const timestamp = typeof time === 'number' ? time : time.getTime();
    const delay = timestamp - Date.now();
    
    if (delay <= 0) {
      console.error('Timpul programat a trecut deja');
      return false;
    }
    
    // Generăm un ID unic pentru acțiunea programată
    const actionId = `${groupId}_${action}_${timestamp}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Salvăm acțiunea în lista de acțiuni programate
    this.scheduledActions.set(actionId, { groupId, action, time: timestamp, params });
    
    // Programăm acțiunea
    setTimeout(async () => {
      try {
        switch (action) {
          case 'message':
            await this.sock.sendMessage(groupId, params.message);
            break;
          case 'title':
            await this.sock.groupUpdateSubject(groupId, params.title);
            break;
          case 'description':
            await this.sock.groupUpdateDescription(groupId, params.description);
            break;
          case 'remove':
            await this.sock.groupParticipantsUpdate(groupId, params.participants, 'remove');
            break;
          case 'add':
            await this.sock.groupParticipantsUpdate(groupId, params.participants, 'add');
            break;
          case 'promote':
            await this.setGroupAdmins(groupId, params.participants, false);
            break;
          case 'demote':
            await this.setGroupAdmins(groupId, params.participants, true);
            break;
          case 'announce':
            await this.sock.groupSettingUpdate(groupId, 'announcement');
            break;
          case 'not_announce':
            await this.sock.groupSettingUpdate(groupId, 'not_announcement');
            break;
          case 'restrict':
            await this.sock.groupSettingUpdate(groupId, 'locked');
            break;
          case 'unrestrict':
            await this.sock.groupSettingUpdate(groupId, 'unlocked');
            break;
          default:
            console.error('Acțiune necunoscută:', action);
        }
        
        // Eliminăm acțiunea din lista de acțiuni programate
        this.scheduledActions.delete(actionId);
      } catch (error) {
        console.error('Eroare la executarea acțiunii programate:', error);
      }
    }, delay);
    
    return true;
  }

  /**
   * Anulează o acțiune programată
   * @param {string} actionId ID-ul acțiunii de anulat
   * @returns {boolean} True dacă s-a anulat, False dacă nu există
   */
  cancelScheduledAction(actionId) {
    return this.scheduledActions.delete(actionId);
  }

  /**
   * Obține toate acțiunile programate
   * @param {string} groupId Filtrează după ID-ul grupului (opțional)
   * @returns {Array} Lista de acțiuni programate
   */
  getScheduledActions(groupId = null) {
    const actions = [];
    for (const [id, action] of this.scheduledActions.entries()) {
      if (!groupId || action.groupId === groupId) {
        actions.push({ id, ...action });
      }
    }
    return actions;
  }

  /**
   * Obține informații despre un grup specific
   * @param {string} groupId ID-ul grupului
   * @returns {Object|null} Informațiile grupului sau null dacă nu există
   */
  getGroupInfo(groupId) {
    return this.groups.get(groupId) || null;
  }

  /**
   * Obține lista tuturor grupurilor
   * @returns {Array} Lista cu informații despre toate grupurile
   */
  getAllGroups() {
    return Array.from(this.groups.values());
  }
}

// Exportăm clasa pentru a fi utilizată în alte module
module.exports = GroupManager;