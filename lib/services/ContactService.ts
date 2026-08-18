import {
  listContacts,
  getContactById,
  getContactByPhone,
  updateContact,
  getOrCreateContact,
} from "@/lib/repo";

export const ContactService = {
  async list(organizationId: string) {
    return listContacts(organizationId);
  },

  async getById(organizationId: string, contactId: string) {
    return getContactById(organizationId, contactId);
  },

  async getByPhone(organizationId: string, phoneNumber: string) {
    return getContactByPhone(organizationId, phoneNumber);
  },

  async update(
    organizationId: string,
    contactId: string,
    payload: {
      name?: string;
      phoneNumber?: string;
      blocked?: boolean;
      botDisabled?: boolean;
      internalNote?: string | null;
    },
  ) {
    return updateContact(organizationId, contactId, payload);
  },

  async getOrCreate(organizationId: string, phoneNumber: string, name: string) {
    return getOrCreateContact(organizationId, phoneNumber, name);
  },
};
