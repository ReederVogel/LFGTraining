import { Avatar } from '@/types/avatar';

export const avatars: Avatar[] = [
  {
    id: '513fd1b7-7ef9-466d-9af2-344e51eeb833',
    name: 'Sarah (Widow)',
    embedId: '91d9caa7-cdc1-4b30-a6bf-fa4208d52a8a',
    contextId: '650be533-548b-4926-80b8-403fd685d1bc',
    imageUrl: '/images/sarah-avatar.jpg',
  },
  {
    id: '55eec60c-d665-4972-a529-bbdcaf665ab8',
    name: 'Michael (Son)',
    embedId: '0cd03d14-a43e-44c7-8398-a8be3e01bf27',
    contextId: '9894cec1-992d-4155-bfee-50f250eacef7',
    imageUrl: '/images/michael-avatar.jpg',
  },
];

export function getAvatarById(id: string): Avatar | undefined {
  return avatars.find((avatar) => avatar.id === id);
}

export function getAvatarByEmbedId(embedId: string): Avatar | undefined {
  return avatars.find((avatar) => avatar.embedId === embedId);
}

