import {
  uploadBase64ToCloudinary,
  uploadTwilioMediaToCloudinary,
  generateSignedUrl,
  deleteCloudinaryResources,
} from "@/lib/cloudinary";

export const CloudinaryService = {
  async uploadBase64(base64Data: string, mimeType?: string | null) {
    return uploadBase64ToCloudinary(base64Data, mimeType);
  },

  async uploadFromUrl(mediaUrl: string, mimeType?: string | null) {
    return uploadTwilioMediaToCloudinary(mediaUrl, mimeType);
  },

  getSignedUrl(publicId: string, expiresInSeconds = 3600) {
    return generateSignedUrl(publicId, expiresInSeconds);
  },

  async deleteResources(publicIds: string[]) {
    await deleteCloudinaryResources(publicIds);
  },
};
