import { IDownloadJob, IStorageUsage } from './download.interface';

export type IDownloadEvent =
  | { type: 'job'; job: IDownloadJob }
  | { type: 'removed'; identifier: string }
  | { type: 'storage'; storage: IStorageUsage };
