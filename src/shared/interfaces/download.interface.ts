export type DownloadState = 'queued' | 'downloading' | 'completed' | 'failed' | 'canceled';

export interface IDownloadJob {
  identifier: string;
  title: string;
  state: DownloadState;
  receivedBytes: number;
  totalBytes: number;
  attempt: number;
  maxAttempts: number;
  error: string | null;
  updatedAt: Date;
}

export interface IStorageUsage {
  isConfigured: boolean;
  usedBytes: number;
  limitBytes: number;
  freeBytes: number;
}

export interface IDownloadSnapshot {
  jobs: IDownloadJob[];
  storage: IStorageUsage;
}
