export interface Avatar {
  id: string;
  name: string;
  role: string;
  scenario: string;
  avatarId: string; // LiveAvatar avatar ID
  voiceId?: string; // LiveAvatar voice ID (optional)
  contextId?: string; // LiveAvatar context ID (optional)
  imageSrc?: string; // Optional avatar image path (from /public)
  openaiPromptId?: string; // OpenAI prompt ID for custom mode
  openaiPromptVersion?: string; // OpenAI prompt version
}

export const avatars: Avatar[] = [
  {
    id: "sarah",
    name: "Sarah",
    role: "Widow",
    scenario: "Lost her husband",
    avatarId: "513fd1b7-7ef9-466d-9af2-344e51eeb833",
    voiceId: "b9d23d16-9437-44d5-89c4-b4dd61c3fdc8",
    contextId: "d7c15ce9-4359-4790-bf1b-8a786a958289",
    imageSrc: "/avatars/sarah-avatar.jpg",
    openaiPromptId: "pmpt_692533270e8c81939cb2030024753c36043ae653ab747fbc",
    openaiPromptVersion: "8",
  },
  {
    id: "michael",
    name: "Michael",
    role: "Son",
    scenario: "Lost his father",
    avatarId: "55eec60c-d665-4972-a529-bbdcaf665ab8",
    contextId: "c77340be-22b0-4927-b5ab-fa88455124f7",
    imageSrc: "/avatars/michael-avatar.jpg",
    openaiPromptId: "pmpt_69255833be5881969a360d5e2352410d0f22b7676fbf534a",
    openaiPromptVersion: "4",
  },
];

export const getAvatarById = (id: string): Avatar | undefined => {
  return avatars.find((avatar) => avatar.id === id);
};

