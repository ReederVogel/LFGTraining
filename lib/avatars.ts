import { Avatar } from '@/types/avatar';

export const avatars: Avatar[] = [
  {
    id: '513fd1b7-7ef9-466d-9af2-344e51eeb833', // LiveAvatar SDK avatar ID for widow
    name: 'Sarah (Widow)',
    embedId: '91d9caa7-cdc1-4b30-a6bf-fa4208d52a8a', // Kept for compatibility (not used)
    contextId: '1803fa71-78fa-4814-b171-3887ee48f50f', // widow context from API
    imageUrl: '/images/sarah-avatar.jpg',
  },
  {
    id: '55eec60c-d665-4972-a529-bbdcaf665ab8', // LiveAvatar SDK avatar ID for son
    name: 'Michael (Son)',
    embedId: '0cd03d14-a43e-44c7-8398-a8be3e01bf27', // Kept for compatibility (not used)
    contextId: '7f393a67-ca66-4f69-a3aa-e0c3f4ca083a', // son context from API
    imageUrl: '/images/michael-avatar.jpg',
  },
];

export function getAvatarById(id: string): Avatar | undefined {
  return avatars.find((avatar) => avatar.id === id);
}

export function getAvatarByEmbedId(embedId: string): Avatar | undefined {
  return avatars.find((avatar) => avatar.embedId === embedId);
}

