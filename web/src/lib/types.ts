/** Datenformen der Server-API, wie sie die Routen in server/src/routes liefern. */

import type { Game, Text } from "@lykora/spec";

export type { Game, Text };

export type Role = "admin" | "author" | "gamemaster" | "supervisor" | "actor" | "viewer";
export type EventStatus = "draft" | "running" | "paused" | "recalled" | "ended";
export type EventAction = "start" | "pause" | "resume" | "recall" | "end";

export interface User {
  id: string;
  email: string;
  name: string;
}

export interface OrgMembership {
  id: string;
  name: string;
  slug: string;
  role: Role;
}

export interface Me extends User {
  orgs: OrgMembership[];
}

export interface LoginResult {
  token: string;
  expiresAt: string;
  user: User;
}

export interface Member extends User {
  disabled: boolean;
  role: Role;
}

export interface Pause {
  from: string;
  to: string | null;
}

export interface EventDto {
  id: string;
  orgId: string;
  name: string;
  status: EventStatus;
  gameId: string;
  gameVersion: number;
  gameTitle: Text;
  scheduledAt: string | null;
  startedAt: string | null;
  endedAt: string | null;
  pauses: Pause[];
  retentionDays: number;
  purgedAt: string | null;
  createdAt: string;
  join: { code: string; url: string; qr: string };
  supervisorRequired: boolean;
  /** Nur mit Recht event.review */
  supervisorPin?: string;
}

export interface GameSummary {
  id: string;
  title: string;
  archived: boolean;
  created_at: string;
  updated_at: string;
  latest_version: number | null;
}

export interface GameVersionInfo {
  version: number;
  comment: string | null;
  created_at: string;
  created_by: string | null;
}

export interface GameDetail extends GameSummary {
  org_id: string;
  content: Game;
  versions: GameVersionInfo[];
}

export interface GameVersion {
  version: number;
  content: Game;
  comment: string | null;
  created_at: string;
}

export interface ValidationResult {
  errors: string[];
  warnings: string[];
}

export interface PublicTeam {
  id: string;
  name: string;
  color: string | null;
  members: string[];
  supervisorPresent: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  arrivedAt: string | null;
  lastSeenAt: string | null;
  lastHeartbeatAt: string | null;
  battery: number | null;
}

export type WarningKind =
  | "sos"
  | "heartbeat_overdue"
  | "no_contact"
  | "stuck"
  | "in_restricted_zone"
  | "near_restricted_zone"
  | "outside_field"
  | "battery_low"
  | "review_pending"
  | "crowded_station";

export interface Warning {
  kind: WarningKind;
  teamId?: string;
  stationId?: string;
  zoneId?: string;
  minutes?: number;
  message: string;
}

export interface Position {
  lat: number;
  lon: number;
  accuracy: number | null;
  at: string | null;
}

export interface OverviewTeam extends PublicTeam {
  position: Position | null;
  progress: {
    solved: number;
    stations: number;
    fragments: number;
    totalFragments: number;
    hintsUsed: number;
    points: number;
    rank?: number;
    timePenalty: number;
  };
  openSos: number;
  warnings: Warning[];
}

export interface Overview {
  event: EventDto;
  teams: OverviewTeam[];
  warnings: Warning[];
}

export interface TeamStateSummary {
  startedAt: string | null;
  finishedAt: string | null;
  triggered: string[];
  solved: string[];
  revealed: string[];
  locked: string[];
  fragments: string[];
  items: string[];
  chapters: string[];
  hints: Record<string, number>;
  hintsUsed: number;
  wrongAnswers: number;
  points: number;
  timePenalty: number;
  lockedUntil: string | null;
  pendingReviews: string[];
}

export interface Outcome {
  clientId: string;
  status: "ok" | "rejected" | "ignored";
  reason?: string;
  verdict?: "correct" | "wrong" | "pending";
}

export interface ActionRow {
  client_id: string;
  source: "team" | "staff";
  type: string;
  payload: Record<string, unknown>;
  client_time: string;
  received_at: string;
  outcome?: Outcome;
}

export interface TeamDetail extends PublicTeam {
  /** Nur mit Recht event.review */
  emergencyPhone?: string | null;
  deviceCode?: string;
  state: TeamStateSummary;
  actions: ActionRow[];
}

export interface TrackPoint {
  lat: number;
  lon: number;
  accuracy: number | null;
  recorded_at: string;
}

export type MessageKind = "chat" | "hint" | "system" | "story" | "predefined" | "cue";

export interface Message {
  id: number;
  team_id: string | null;
  team_name: string | null;
  direction: "to_team" | "from_team";
  kind: MessageKind;
  sender: string | null;
  body: string;
  created_at: string;
  read_at: string | null;
  user_name: string | null;
}

export interface Sos {
  id: string;
  event_id: string;
  team_id: string;
  client_id: string | null;
  channel: "app" | "deferred" | "sms" | "lora";
  lat: number | null;
  lon: number | null;
  accuracy: number | null;
  message: string | null;
  client_time: string;
  received_at: string;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  resolved_at: string | null;
  team_name: string;
  emergency_phone: string | null;
  acknowledged_by_name: string | null;
}

export interface LogEntry {
  id: number;
  kind: string;
  data: Record<string, unknown>;
  at: string;
  team_id: string | null;
  team_name: string | null;
  user_name: string | null;
}

export interface Standing {
  teamId: string;
  rank: number;
  points: number;
  solved: number;
  fragments: number;
  hintsUsed: number;
  finished: boolean;
  finishTime: number | null;
  firstOnSite: string[];
  name?: string;
}

export interface MaterialItem {
  station?: string;
  stationName?: string;
  name: string;
  kind?: string;
  quantity?: number;
  note?: string;
  perTeam?: boolean;
}

export interface Materials {
  items: MaterialItem[];
  teamGear: MaterialItem[];
}

export type MediaType = "audio" | "image" | "video";

export interface MediaFile {
  id: string;
  gameId: string;
  sha256: string;
  filename: string;
  contentType: string;
  type: MediaType;
  size: number;
  src: string;
  url: string;
  createdAt: string;
}

export interface LibrarySound {
  id: string;
  title: string;
  category: "ambience" | "sfx";
  loop: boolean;
  duration: number;
  src: string;
  url: string;
  license: string;
  credit: string;
}

export interface CueBody {
  audio: string;
  src?: string;
  volume?: number;
  text?: string;
}

/** Live-Ereignis vom Dashboard-WebSocket. */
export interface LiveEvent {
  type: "hello" | "status" | "message" | "sos" | "upload" | "team_joined" | "position" | "team" | "log";
  data: unknown;
  at?: string;
}
