import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { ChatMessage } from '@/lib/llm/types';
import type { NewResource, Project, ProjectResource } from '@/lib/projects';

export interface Conversation {
  id: string;
  title: string;
  projectId: string | null;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
}

interface ChatState {
  projects: Project[];
  conversations: Conversation[];

  createProject(name: string, instructions?: string): Project;
  updateProject(id: string, patch: Partial<Pick<Project, 'name' | 'instructions'>>): void;
  deleteProject(id: string): void;
  addResource(projectId: string, resource: NewResource): void;
  removeResource(projectId: string, resourceId: string): void;

  createConversation(projectId: string | null): Conversation;
  renameConversation(id: string, title: string): void;
  deleteConversation(id: string): void;
  appendMessages(id: string, messages: ChatMessage[]): void;
  /** Removes messages from `fromMessageId` (inclusive) to the end; used by retry. */
  truncateFrom(id: string, fromMessageId: string): void;
}

const uuid = () => Crypto.randomUUID();

export const TITLE_MAX = 48;

export function titleFrom(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  if (!oneLine) return 'New conversation';
  return oneLine.length > TITLE_MAX ? `${oneLine.slice(0, TITLE_MAX - 1)}…` : oneLine;
}

export const useChat = create<ChatState>()(
  persist(
    (set, get) => ({
      projects: [],
      conversations: [],

      createProject(name, instructions = '') {
        const project: Project = { id: uuid(), name: name.trim() || 'Untitled project', instructions, resources: [], createdAt: Date.now() };
        set({ projects: [project, ...get().projects] });
        return project;
      },
      updateProject: (id, patch) =>
        set({ projects: get().projects.map((p) => (p.id === id ? { ...p, ...patch } : p)) }),
      deleteProject(id) {
        set({
          projects: get().projects.filter((p) => p.id !== id),
          // Conversations survive as unassigned rather than disappearing with the project.
          conversations: get().conversations.map((c) => (c.projectId === id ? { ...c, projectId: null } : c)),
        });
      },
      addResource(projectId, resource) {
        set({
          projects: get().projects.map((p) =>
            p.id === projectId ? { ...p, resources: [...p.resources, { ...resource, id: uuid() } as ProjectResource] } : p,
          ),
        });
      },
      removeResource: (projectId, resourceId) =>
        set({
          projects: get().projects.map((p) =>
            p.id === projectId ? { ...p, resources: p.resources.filter((r) => r.id !== resourceId) } : p,
          ),
        }),

      createConversation(projectId) {
        const now = Date.now();
        const conv: Conversation = { id: uuid(), title: 'New conversation', projectId, createdAt: now, updatedAt: now, messages: [] };
        set({ conversations: [conv, ...get().conversations] });
        return conv;
      },
      renameConversation: (id, title) =>
        set({ conversations: get().conversations.map((c) => (c.id === id ? { ...c, title: title.trim() || c.title } : c)) }),
      deleteConversation: (id) => set({ conversations: get().conversations.filter((c) => c.id !== id) }),
      appendMessages(id, messages) {
        set({
          conversations: get().conversations.map((c) => {
            if (c.id !== id) return c;
            const firstUser = c.messages.length === 0 ? messages.find((m) => m.role === 'user') : undefined;
            return {
              ...c,
              title: firstUser ? titleFrom(firstUser.content) : c.title,
              updatedAt: Date.now(),
              messages: [...c.messages, ...messages],
            };
          }),
        });
      },
      truncateFrom(id, fromMessageId) {
        set({
          conversations: get().conversations.map((c) => {
            if (c.id !== id) return c;
            const idx = c.messages.findIndex((m) => m.id === fromMessageId);
            return idx === -1 ? c : { ...c, messages: c.messages.slice(0, idx), updatedAt: Date.now() };
          }),
        });
      },
    }),
    { name: 'remocode.chat.v1', storage: createJSONStorage(() => AsyncStorage) },
  ),
);

export function newMessageId(): string {
  return uuid();
}
