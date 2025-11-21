/**
 * Utility functions for exporting transcripts
 */

interface TranscriptMessage {
  speaker: 'user' | 'avatar';
  text: string;
  timestamp: Date;
  isInterim?: boolean;
}

/**
 * Export transcripts as a plain text file
 */
export function exportTranscriptsAsText(
  transcripts: TranscriptMessage[],
  filename?: string
): void {
  const finalTranscripts = transcripts.filter(m => !m.isInterim);
  
  const text = finalTranscripts
    .map(m => `[${m.timestamp.toLocaleTimeString()}] ${m.speaker.toUpperCase()}: ${m.text}`)
    .join('\n\n');
  
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || `transcript-${new Date().toISOString().split('T')[0]}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Export transcripts as a JSON file
 */
export function exportTranscriptsAsJSON(
  transcripts: TranscriptMessage[],
  filename?: string
): void {
  const finalTranscripts = transcripts.filter(m => !m.isInterim);
  
  const data = {
    exportDate: new Date().toISOString(),
    totalMessages: finalTranscripts.length,
    userMessages: finalTranscripts.filter(m => m.speaker === 'user').length,
    avatarMessages: finalTranscripts.filter(m => m.speaker === 'avatar').length,
    transcripts: finalTranscripts.map(m => ({
      speaker: m.speaker,
      text: m.text,
      timestamp: m.timestamp.toISOString(),
    })),
  };
  
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || `transcript-${new Date().toISOString().split('T')[0]}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Export transcripts as a formatted Markdown file
 */
export function exportTranscriptsAsMarkdown(
  transcripts: TranscriptMessage[],
  filename?: string
): void {
  const finalTranscripts = transcripts.filter(m => !m.isInterim);
  
  let markdown = `# Conversation Transcript\n\n`;
  markdown += `**Date:** ${new Date().toLocaleDateString()}\n\n`;
  markdown += `**Total Messages:** ${finalTranscripts.length}\n\n`;
  markdown += `---\n\n`;
  
  finalTranscripts.forEach(m => {
    const icon = m.speaker === 'user' ? '👤' : '🤖';
    const speaker = m.speaker === 'user' ? 'You' : 'Avatar';
    markdown += `### ${icon} ${speaker} - ${m.timestamp.toLocaleTimeString()}\n\n`;
    markdown += `${m.text}\n\n`;
  });
  
  const blob = new Blob([markdown], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || `transcript-${new Date().toISOString().split('T')[0]}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Copy transcripts to clipboard
 */
export async function copyTranscriptsToClipboard(
  transcripts: TranscriptMessage[]
): Promise<void> {
  const finalTranscripts = transcripts.filter(m => !m.isInterim);
  
  const text = finalTranscripts
    .map(m => `[${m.timestamp.toLocaleTimeString()}] ${m.speaker.toUpperCase()}: ${m.text}`)
    .join('\n\n');
  
  await navigator.clipboard.writeText(text);
}

