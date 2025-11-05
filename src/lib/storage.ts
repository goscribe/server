// src/server/lib/storage.ts
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';

// Initialize Supabase Storage
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing required Supabase environment variables: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const bucketName = process.env.SUPABASE_BUCKET || 'media';

export interface UploadResult {
  url: string;
  signedUrl?: string;
  objectKey: string;
}

export async function uploadToSupabase(
  fileBuffer: Buffer,
  fileName: string,
  contentType: string,
  makePublic: boolean = false
): Promise<UploadResult> {
  const objectKey = `podcasts/${uuidv4()}_${fileName}`;

  // Upload the file to Supabase Storage
  const { data, error } = await supabase.storage
    .from(bucketName)
    .upload(objectKey, fileBuffer, {
      contentType,
      upsert: false,
    });

  if (error) {
    throw new Error(`Failed to upload file to Supabase: ${error.message}`);
  }

  const url = `${supabaseUrl}/storage/v1/object/public/${bucketName}/${objectKey}`;
  
  // Generate signed URL for private files
  let signedUrl: string | undefined;
  if (!makePublic) {
    const { data: signedUrlData, error: signedUrlError } = await supabase.storage
      .from(bucketName)
      .createSignedUrl(objectKey, 24 * 60 * 60); // 24 hours

    if (signedUrlError) {
      throw new Error(`Failed to generate signed URL: ${signedUrlError.message}`);
    }
    signedUrl = signedUrlData.signedUrl;
  }

  return {
    url,
    signedUrl,
    objectKey,
  };
}

export async function generateSignedUrl(objectKey: string, expiresInHours: number = 24): Promise<string> {
  const { data, error } = await supabase.storage
    .from(bucketName)
    .createSignedUrl(objectKey, expiresInHours * 60 * 60);

  if (error) {
    throw new Error(`Failed to generate signed URL: ${error.message}`);
  }

  return data.signedUrl;
}

export async function deleteFromSupabase(objectKey: string): Promise<void> {
  const { error } = await supabase.storage
    .from(bucketName)
    .remove([objectKey]);

  if (error) {
    throw new Error(`Failed to delete file from Supabase: ${error.message}`);
  }
}

export async function makeFilePublic(objectKey: string): Promise<void> {
  // In Supabase, files are public by default when uploaded to public buckets
  // For private buckets, you would need to update the bucket policy
  // This function is kept for compatibility but may not be needed
  console.log(`File ${objectKey} is already public in Supabase Storage`);
}

export async function makeFilePrivate(objectKey: string): Promise<void> {
  // In Supabase, you would need to update the bucket policy to make files private
  // This function is kept for compatibility but may not be needed
  console.log(`File ${objectKey} privacy is controlled by bucket policy in Supabase Storage`);
}

// Export supabase client for direct access if needed
export const supabaseClient = supabase;