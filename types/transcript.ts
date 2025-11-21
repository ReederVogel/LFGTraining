export interface TranscriptMessage {
  id: string;
  speaker: 'user' | 'avatar';
  text: string;
  timestamp: Date;
  isInterim?: boolean; // For real-time updates
}

export interface UserInfo {
  name: string;
  avatarUrl?: string;
}

