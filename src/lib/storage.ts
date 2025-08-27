// src/server/lib/gcs.ts
import { Storage } from '@google-cloud/storage';
import { v4 as uuidv4 } from 'uuid';

// Initialize Google Cloud Storage
const storage = new Storage({
  projectId: process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT_ID,
  credentials: process.env.GCP_CLIENT_EMAIL && process.env.GCP_PRIVATE_KEY ? {
    client_email: process.env.GCP_CLIENT_EMAIL,
    private_key: process.env.GCP_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  } : undefined,
  keyFilename: process.env.GOOGLE_CLOUD_KEY_FILE || process.env.GCP_KEY_FILE,
});

const bucketName = process.env.GCP_BUCKET || process.env.GOOGLE_CLOUD_BUCKET_NAME || 'your-bucket-name';

export interface UploadResult {
  url: string;
  signedUrl?: string;
  objectKey: string;
}

export async function uploadToGCS(
  fileBuffer: Buffer,
  fileName: string,
  contentType: string,
  makePublic: boolean = false
): Promise<UploadResult> {
  const bucket = storage.bucket(bucketName);
  const objectKey = `podcasts/${uuidv4()}_${fileName}`;
  const file = bucket.file(objectKey);

  // Upload the file
  await file.save(fileBuffer, {
    metadata: {
      contentType,
    },
    public: makePublic,
  });

  const url = `gs://${bucketName}/${objectKey}`;
  
  // Generate signed URL for private files
  let signedUrl: string | undefined;
  if (!makePublic) {
    const [signedUrlResult] = await file.getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
    });
    signedUrl = signedUrlResult;
  }

  return {
    url,
    signedUrl,
    objectKey,
  };
}

export async function generateSignedUrl(objectKey: string, expiresInHours: number = 24): Promise<string> {
  const bucket = storage.bucket(bucketName);
  const file = bucket.file(objectKey);

  const [signedUrl] = await file.getSignedUrl({
    version: 'v4',
    action: 'read',
    expires: Date.now() + expiresInHours * 60 * 60 * 1000,
  });

  return signedUrl;
}

export async function deleteFromGCS(objectKey: string): Promise<void> {
  const bucket = storage.bucket(bucketName);
  const file = bucket.file(objectKey);
  
  await file.delete();
}

export async function makeFilePublic(objectKey: string): Promise<void> {
  const bucket = storage.bucket(bucketName);
  const file = bucket.file(objectKey);
  
  await file.makePublic();
}

export async function makeFilePrivate(objectKey: string): Promise<void> {
  const bucket = storage.bucket(bucketName);
  const file = bucket.file(objectKey);
  
  await file.makePrivate();
}


export const bucket = storage.bucket(bucketName);