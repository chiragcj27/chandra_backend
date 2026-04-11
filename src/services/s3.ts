import {
  CopyObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../config/env";

export const s3 = new S3Client({
  region: env.AWS_REGION,
  credentials: {
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
  },
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
});

export function s3KeyToPublicUrl(key: string): string {
  const base = env.S3_PUBLIC_BASE_URL.replace(/\/+$/, "");
  const safeKey = key.replace(/^\/+/, "");
  return `${base}/${safeKey}`;
}

export async function presignPutObject(params: {
  key: string;
  contentType: string;
  expiresInSeconds?: number;
}): Promise<string> {
  const cmd = new PutObjectCommand({
    Bucket: env.S3_BUCKET,
    Key: params.key,
    ContentType: params.contentType,
  });
  return await getSignedUrl(s3, cmd, { expiresIn: params.expiresInSeconds ?? 60 });
}

export async function headObject(key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

export async function copyObject(params: { fromKey: string; toKey: string; contentType?: string }) {
  await s3.send(
    new CopyObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: params.toKey,
      CopySource: `${env.S3_BUCKET}/${params.fromKey}`,
      ContentType: params.contentType,
      MetadataDirective: params.contentType ? "REPLACE" : "COPY",
    })
  );
}

export async function deleteObject(key: string): Promise<void> {
  await s3.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
}

