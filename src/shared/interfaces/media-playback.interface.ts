// Where the player can load a media directly: a signed storage link for downloaded media, null otherwise.
// isDownloaded with a null url means the copy exists but storage refuses it right now (e.g. B2's daily download cap),
// so the player streams from the source instead.
export interface IMediaPlayback {
  url: string | null;
  isDownloaded: boolean;
}
