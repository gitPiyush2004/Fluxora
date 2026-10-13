import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { keys } from '@/lib/query-keys';
import type { Member, Role } from '@/lib/types';

export interface MembersResponse {
  members: Member[];
  invites: { id: string; email: string; role: Role; createdAt: string }[];
}

export const useMembers = () =>
  useQuery({ queryKey: keys.members, queryFn: async () => (await api.get<MembersResponse>('/organizations/current/members')).data });
