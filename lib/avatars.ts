export interface Avatar {
  id: string;
  name: string;
  role: string;
  scenario: string;
  avatarId: string; // LiveAvatar avatar ID
  voiceId?: string; // LiveAvatar voice ID (optional)
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
    imageSrc: "/avatars/sarah-avatar.jpg",
    openaiPromptId: "pmpt_6937af0af54c8194a222443fc44bb6ea030cfc3ca45af86f",
    openaiPromptVersion: "19",
  },
  {
    id: "michael",
    name: "Michael",
    role: "Son",
    scenario: "Lost his father",
    avatarId: "55eec60c-d665-4972-a529-bbdcaf665ab8",
    imageSrc: "/avatars/michael-avatar.jpg",
    openaiPromptId: "pmpt_6937b0a609588193b7e17f9dfd58059c08bf87cb045b5637",
    openaiPromptVersion: "4",
  },
];

export const getAvatarById = (id: string): Avatar | undefined => {
  return avatars.find((avatar) => avatar.id === id);
};

