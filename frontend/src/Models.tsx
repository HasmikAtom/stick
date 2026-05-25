export interface TorrentStatus {
  id: number;
  name: string;
  percentDone: number;
  rateDownload: number;
  totalSize: number;
  addedDate: number;
  doneDate: number;
  status: string;
}

export interface ScrapedTorrents {
  id:          string;
  title:       string;
  category:    string;
  uploader:    string;
  size:        string;
  upload_date:  string;
  se:     number;
  le:    number;
  description_url: string;

  magnet:      string; // for piratebay
  download_url: string; // for rutracker

  downloads: string;
}

export interface SelectedTorrent {
  id: string;
  downloadUrl: string; // magnet for PirateBay, download_url for RuTracker
}

export interface PreparedTorrent {
  id: number;
  name: string;
  ready: boolean;
}

export interface PreparedTorrentStatus {
  id: number;
  name: string;
  ready: boolean;
  metadataPercentComplete: number;
}

export interface BatchPrepareResponse {
  torrents: PreparedTorrent[];
  errors?: string[];
}
