/** Types and small helpers shared by the public learning pages. */

export type LessonCard = {
  id: string;
  slug: string;
  title: string;
  summary: string;
  difficulty: string;
  topics: string[];
  concept: string;
  category: string;
  complexity: string;
  theme: string;
  hasVideo: boolean;
};

export type HomePayload = {
  user: { id: string; name: string; role: string } | null;
  topics: string[];
  featured: { slug: string; title: string; description: string; lessonCount: number } | null;
  recent: LessonCard[];
  recommended: LessonCard[];
  continueLearning: { slug: string; title: string; state: string; last_mode: string; updated_at: string }[];
  stats: { lessons: number; roadmaps: number; withVideo: number };
};

export type RoadmapSummary = {
  slug: string;
  title: string;
  description: string;
  prerequisites: string;
  outcomes: string;
  lessonCount: number;
};

export type RoadmapLesson = {
  id: string;
  slug: string;
  title: string;
  summary: string;
  difficulty: string;
  state: 'completed' | 'in-progress' | 'available' | 'locked';
};

export type RoadmapPayload = {
  roadmap: { slug: string; title: string; description: string; prerequisites: string; outcomes: string };
  modules: { id: string; title: string; summary: string; lessons: RoadmapLesson[] }[];
  total: number;
  completed: number;
  next: RoadmapLesson | null;
};

export type LessonSection = { id: string; heading: string; body: string; kind: string };

export type CodeExample = {
  id: string;
  language: string;
  label: string;
  code: string;
  expectedOutput: string;
  notes: string;
};

export type QuizQuestion = {
  id: string;
  prompt: string;
  options: string[];
  answerIndex: number;
  explanation: string;
};

export type LearnedLesson = {
  lesson: LessonCard & {
    objectives: string[];
    prerequisites: string;
    hook: string;
    takeaway: string;
    version: number;
    publishedAt: string | null;
  };
  concept: {
    name: string;
    category: string;
    plain: string;
    technical: string;
    pseudocode: string;
    exampleInput: string;
    expectedOutput: string;
    complexityTime: string;
    complexitySpace: string;
  };
  sections: LessonSection[];
  code: CodeExample[];
  video: {
    id: string;
    audioMode: string;
    durationSeconds: number;
    width: number;
    height: number;
    theme: string;
    variants: { id: string; audioMode: string }[];
  } | null;
  thumbnailUrl: string | null;
  quiz: QuizQuestion[];
  roadmap: {
    roadmapSlug: string;
    roadmapTitle: string;
    moduleTitle: string;
    prev: { slug: string; title: string } | null;
    next: { slug: string; title: string } | null;
    index: number;
    total: number;
  } | null;
  derived: {
    videos: { present: boolean; stale: boolean; ready: number };
    narration: { present: boolean; stale: boolean };
  };
  progress: { state: string; last_mode: string; updated_at: string } | null;
  bookmarked: boolean;
  guest: boolean;
};

export type MyLearningPayload = {
  user: { id: string; name: string; email: string; role: string };
  inProgress: { slug: string; title: string; summary: string; state: string; last_mode: string; updated_at: string }[];
  completed: { slug: string; title: string; summary: string; updated_at: string }[];
  saved: { slug: string; title: string; summary: string }[];
  roadmaps: {
    slug: string;
    title: string;
    total: number;
    completed: number;
    next: { slug: string; title: string } | null;
  }[];
  recent: { slug: string; title: string; state: string; updated_at: string }[];
};

export function difficultyLabel(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : 'Beginner';
}
