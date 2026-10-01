// Card details the client sends with like, favorite, and watch-position writes, so a stored media can be shown without a search.
export interface IMediaSnapshot {
  title: string;
  duration: number;
  postedAt: string;
  thumbnailSrc: string[];
}
