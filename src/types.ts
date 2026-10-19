export type Kind = 'Article' | 'SI' | 'PeerReview' | 'Unknown';
export type Field = 'journal' | 'year' | 'author' | 'title';
export interface Metadata {
  journal: string; journalFull: string; issn: string[]; year: string; author: string; title: string;
  doi: string; volume: string; sources: Partial<Record<Field, string>>; issues: string[];
}
export interface PaperLink { url: string; kind: Kind; label: string }
export interface Snapshot {
  pageUrl: string; canonicalUrl: string; metadata: Metadata; links: PaperLink[]; capturedAt: number;
  lookupNote?: string;
}
export interface DownloadLike { id: number; url: string; finalUrl: string; referrer: string; filename: string; mime: string }
export interface RecordItem {
  id: number; createdAt: number; original: string; actual?: string; proposed?: string;
  state: 'progress' | 'complete' | 'interrupted'; reason: string;
  downloadError?: string; nameMismatch?: boolean;
  metadata?: Metadata; kind: Kind; label: string; pageUrl?: string;
  draft?: { journal: string; year: string; author: string; title: string; kind: Kind; label: string };
}
export interface Settings { enabled: boolean; crossref: boolean; abbreviations: Record<string, string> }
export const DEFAULT_SETTINGS: Settings = { enabled: true, crossref: true, abbreviations: {} };
export const TTL = 7 * 24 * 60 * 60 * 1000;
export const emptyMetadata = (): Metadata => ({ journal: '', journalFull: '', issn: [], year: '', author: '', title: '', doi: '', volume: '', sources: {}, issues: [] });
