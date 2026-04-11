import {
  CopyObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { env, type AwsConfig } from "../config/env";

let s3Client: S3Client | null = null;

function requireAws(): AwsConfig {
  if (!env.aws) {
    throw new Error(
      "S3 is not configured. Set AWS_REGION, S3_BUCKET, S3_PUBLIC_BASE_URL, AWS_ACCESS_KEY_ID, and AWS_SECRET_ACCESS_KEY."
    );
  }
  return env.aws;
}

function getS3Client(): S3Client {
  const e = requireAws();
  if (!s3Client) {
    s3Client = new S3Client({
      region: e.region,
      credentials: {
        accessKeyId: e.accessKeyId,
        secretAccessKey: e.secretAccessKey,
      },
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  }
  return s3Client;
}

export function s3KeyToPublicUrl(key: string): string {
  const e = requireAws();
  const base = e.publicBaseUrl.replace(/\/+$/, "");
  const safeKey = key.replace(/^\/+/, "");
  return `${base}/${safeKey}`;
}

export async function presignPutObject(params: {
  key: string;
  contentType: string;
  expiresInSeconds?: number;
}): Promise<string> {
  const e = requireAws();
  const cmd = new PutObjectCommand({
    Bucket: e.bucket,
    Key: params.key,
    ContentType: params.contentType,
  });
  return await getSignedUrl(getS3Client(), cmd, { expiresIn: params.expiresInSeconds ?? 60 });
}

export async function headObject(key: string): Promise<boolean> {
  const e = requireAws();
  try {
    await getS3Client().send(new HeadObjectCommand({ Bucket: e.bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
}

export async function copyObject(params: { fromKey: string; toKey: string; contentType?: string }) {
  const e = requireAws();
  await getS3Client().send(
    new CopyObjectCommand({
      Bucket: e.bucket,
      Key: params.toKey,
      CopySource: `${e.bucket}/${params.fromKey}`,
      ContentType: params.contentType,
      MetadataDirective: params.contentType ? "REPLACE" : "COPY",
    })
  );
}

export async function deleteObject(key: string): Promise<void> {
  const e = requireAws();
  await getS3Client().send(new DeleteObjectCommand({ Bucket: e.bucket, Key: key }));
}
