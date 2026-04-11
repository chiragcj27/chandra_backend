import dotenv from "dotenv";

dotenv.config();

function required(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`${name} is not set`);
  return val;
}

export const env = {
  PORT: process.env.PORT ? Number(process.env.PORT) : 3000,
  MONGODB_URI: required("MONGODB_URI"),
  JWT_SECRET: required("JWT_SECRET"),
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN ?? "7d",
  /**
   * Optional. Set this to the JWT_SECRET used by the Custom app backend
   * (workflowapi-quhn.onrender.com) so that tokens issued there are also
   * accepted by this backend — enabling a single shared login flow.
   *
   * If omitted, only tokens signed by this backend's own JWT_SECRET are accepted.
   */
  LEGACY_JWT_SECRET: process.env.LEGACY_JWT_SECRET || undefined,
  PASSWORD_SEED: required("PASSWORD_SEED"),
  ADMIN_EMAIL: process.env.ADMIN_EMAIL,
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
  /**
   * Optional. When all of these are set, S3 helpers (uploads, banners, etc.) work.
   * If omitted, the server still starts; routes that need S3 will return 503.
   */
  aws: readAwsConfig(),
} as const;

export type AwsConfig = {
  region: string;
  bucket: string;
  publicBaseUrl: string;
  accessKeyId: string;
  secretAccessKey: string;
};

function readAwsConfig(): AwsConfig | null {
  const region = process.env.AWS_REGION?.trim();
  const bucket = process.env.S3_BUCKET?.trim();
  const publicBaseUrl = process.env.S3_PUBLIC_BASE_URL?.trim();
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY?.trim();

  if (!region || !bucket || !publicBaseUrl || !accessKeyId || !secretAccessKey) {
    return null;
  }

  return { region, bucket, publicBaseUrl, accessKeyId, secretAccessKey };
}

