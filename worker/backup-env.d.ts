
declare global {
  interface Env {
    D1_REST_API_TOKEN: string;
    BACKUP_BUCKET: R2Bucket;
  }
}

export {};
