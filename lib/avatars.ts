export interface Avatar {
  id: string;
  name: string;
  role: string;
  scenario: string;
  avatarId: string; // LiveAvatar avatar ID
  voiceId?: string; // LiveAvatar voice ID (optional)
  contextId?: string; // LiveAvatar context ID (optional)
  imageSrc?: string; // Optional avatar image path (from /public)
}

export const avatars: Avatar[] = [
  {
    id: "sarah",
    name: "Sarah",
    role: "Widow",
    scenario: "Lost her husband",
    avatarId: "513fd1b7-7ef9-466d-9af2-344e51eeb833",
    contextId: "d7c15ce9-4359-4790-bf1b-8a786a958289",
    imageSrc: "/avatars/sarah-avatar.jpg",
  },
  {
    id: "michael",
    name: "Michael",
    role: "Son",
    scenario: "Lost his father",
    avatarId: "55eec60c-d665-4972-a529-bbdcaf665ab8",
    contextId: "c77340be-22b0-4927-b5ab-fa88455124f7",
    imageSrc: "/avatars/michael-avatar.jpg",
  },
];

export const getAvatarById = (id: string): Avatar | undefined => {
  return avatars.find((avatar) => avatar.id === id);
};

