export enum CampaignStatus {
  ACTIVE = 'ACTIVE',
  PAUSED = 'PAUSED',
  COMPLETED = 'COMPLETED',
  ARCHIVED = 'ARCHIVED',
}

export interface CreateCampaignDto {
  name: string;
  description?: string;
}

export interface UpdateCampaignDto {
  name?: string;
  description?: string;
  status?: CampaignStatus;
}

export interface CampaignMemberDto {
  userId: string;
  role: string;
}

export interface InviteToCampaignDto {
  email: string;
  role?: string;
}

export interface GenerateInviteLinkDto {
  expiryHours?: number;
}

export interface CampaignDto {
  id: string;
  name: string;
  description?: string;
  status: CampaignStatus;
  ownerId: string;
  inviteCode?: string;
  inviteExpiry?: Date;
  createdAt: Date;
  updatedAt: Date;
  memberCount?: number;
  roomCount?: number;
  sessionCount?: number;
}

export interface CampaignDetailDto extends CampaignDto {
  members: Array<{
    userId: string;
    userName?: string;
    role: string;
    joinedAt: Date;
  }>;
  rooms: Array<{
    id: string;
    name: string;
    lastActiveAt: Date;
  }>;
  sessions: Array<{
    id: string;
    name?: string;
    startedAt: Date;
    endedAt?: Date;
    participantCount: number;
  }>;
}

export interface GameSessionDto {
  id: string;
  roomId: string;
  campaignId?: string;
  name?: string;
  description?: string;
  notes?: string;
  startedAt: Date;
  endedAt?: Date;
  participantCount: number;
}

export interface CreateGameSessionDto {
  roomId: string;
  campaignId?: string;
  name?: string;
  description?: string;
}

export interface UpdateGameSessionDto {
  name?: string;
  description?: string;
  notes?: string;
  endedAt?: Date;
}
