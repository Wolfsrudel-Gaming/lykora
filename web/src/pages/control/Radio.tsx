/** Funk: Gesprächsverlauf je Team und an alle, Senden als Nachricht, Hinweis oder Story. */

import { useEffect, useRef, useState } from "preact/hooks";
import { formatClock } from "../../lib/format.ts";
import { audioName, incomingTone, KIND_LABELS, parseCue, senderLabel, senderOptions, thread, TONE_LABELS, unreadByTeam } from "../../lib/messages.ts";
import { api, errorText, notify } from "../../lib/session.ts";
import type { Game, Message, OverviewTeam } from "../../lib/types.ts";
import { Field } from "../../ui/components.tsx";
import { Icon } from "../../ui/icons.tsx";

export type Thread = string | "all" | "inbox";
export type SendKind = "chat" | "hint" | "story";

/** Zuletzt gesehene Nachricht je Team, über den Wechsel der Reiter hinweg. */
const seen: Record<string, number> = {};

/** Ungelesene Meldungen von Teams, für die Zahl am Reiter. */
export function unreadTotal(messages: Message[]): number {
  return Object.values(unreadByTeam(messages, seen)).reduce((a, b) => a + b, 0);
}

export function MessageBubble({ m, game, showTeam, onReply }: { m: Message; game: Game | null; showTeam?: boolean; onReply?: () => void }) {
  const incoming = m.direction === "from_team";
  const tone = incomingTone(m);
  const cue = m.kind === "cue" ? parseCue(m.body) : null;
  const who = incoming ? (m.team_name ?? "Team") : senderLabel(m.sender, game);
  return (
    <li class={`msg ${incoming ? "in" : "out"}${m.team_id === null ? " broadcast" : ""}${tone !== "normal" ? ` tone-${tone}` : ""}`}>
      <div class="msg-head small">
        <strong>{who}</strong>
        {!incoming && showTeam && <span class="muted"> an {m.team_id ? (m.team_name ?? "Team") : "alle"}</span>}
        {!incoming && m.team_id === null && !showTeam && <span class="muted"> an alle</span>}
        {m.kind !== "chat" && <span class="badge quiet">{KIND_LABELS[m.kind]}</span>}
        {tone !== "normal" && <span class="badge strong">{TONE_LABELS[tone]}</span>}
        <span class="spacer" />
        <span class="num muted">{formatClock(m.created_at)}</span>
      </div>
      {cue ? (
        <p>
          <Icon name="sound" size={14} /> Klang „{audioName(cue.audio)}“ mit {Math.round((cue.volume ?? 0.8) * 100)} %{cue.text ? ` · ${cue.text}` : ""}
        </p>
      ) : (
        <p class="msg-body">{m.body}</p>
      )}
      {!incoming && m.user_name && <span class="small muted">gesendet von {m.user_name}</span>}
      {incoming && onReply && (
        <button type="button" class="btn small msg-reply" onClick={onReply}>
          <Icon name="send" /> Antworten
        </button>
      )}
    </li>
  );
}

export function Radio({
  eventId,
  game,
  teams,
  messages,
  canSend,
  preset,
  onSent,
}: {
  eventId: string;
  game: Game | null;
  teams: OverviewTeam[];
  messages: Message[];
  canSend: boolean;
  preset: { thread: Thread; kind: SendKind; key: number } | null;
  onSent: () => void;
}) {
  const [current, setCurrent] = useState<Thread>(preset?.thread ?? "inbox");
  const [kind, setKind] = useState<SendKind>(preset?.kind ?? "chat");
  const [sender, setSender] = useState("hq");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [, rerender] = useState(0);
  const list = useRef<HTMLOListElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!preset) return;
    setCurrent(preset.thread);
    setKind(preset.kind);
    input.current?.focus();
  }, [preset?.key]);

  const shown = current === "inbox" ? messages.filter((m) => m.direction === "from_team") : thread(messages, current === "all" ? null : current);

  // Was im offenen Verlauf steht, gilt als gelesen.
  useEffect(() => {
    if (current === "all") return;
    let changed = false;
    for (const m of shown) {
      if (m.direction === "from_team" && m.team_id && m.id > (seen[m.team_id] ?? 0)) {
        seen[m.team_id] = m.id;
        changed = true;
      }
    }
    if (changed) rerender((n) => n + 1);
    list.current?.lastElementChild?.scrollIntoView({ block: "nearest" });
  }, [current, shown.length]);

  const reply = (teamId: string) => {
    setCurrent(teamId);
    setKind("chat");
    setTimeout(() => input.current?.focus(), 0);
  };

  const unread = unreadByTeam(messages, seen);
  const target = current === "inbox" || current === "all" ? null : current;
  const teamName = (id: string) => teams.find((t) => t.id === id)?.name ?? "Team";
  const hintBlocked = kind === "hint" && !target;

  const send = async (e: Event) => {
    e.preventDefault();
    if (!body.trim() || hintBlocked) return;
    setBusy(true);
    try {
      await api.sendMessage(eventId, { teamId: target, body: body.trim(), kind, sender });
      setBody("");
      notify(target ? `An ${teamName(target)} gesendet` : "An alle Teams gesendet", "ok");
      onSent();
    } catch (err) {
      notify(errorText(err), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="radio">
      <div class="radio-threads">
        <div class="field radio-select">
          <label for="funk-verlauf">Verlauf</label>
          <select id="funk-verlauf" value={current} onChange={(e) => setCurrent(e.currentTarget.value)}>
            <option value="inbox">Eingang (alle Meldungen von Teams)</option>
            <option value="all">An alle Teams</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {unread[t.id] ? ` (${unread[t.id]} neu)` : ""}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div class="radio-main">
        <ol class="list msgs" ref={list} aria-live="polite" aria-label="Nachrichten">
          {shown.length === 0 ? (
            <li class="empty">{current === "inbox" ? "Noch keine Meldungen von Teams." : "Noch keine Nachrichten."}</li>
          ) : (
            shown
              .slice(-200)
              .map((m) => (
                <MessageBubble
                  key={m.id}
                  m={m}
                  game={game}
                  showTeam={current === "inbox" || current === "all"}
                  onReply={canSend && current === "inbox" && m.team_id ? () => reply(m.team_id!) : undefined}
                />
              ))
          )}
        </ol>
        {canSend && current === "inbox" && <p class="small muted composer">Zum Antworten bei einer Meldung „Antworten“ wählen oder oben ein Team oder „An alle Teams“.</p>}
        {canSend && current !== "inbox" && (
          <form class="composer stack tight" onSubmit={send}>
            <div class="row">
              <span class="label">An {target ? teamName(target) : "alle Teams"}</span>
            </div>
            <div class="grid-2">
              <Field label="Art">
                <select value={kind} onChange={(e) => setKind(e.currentTarget.value as SendKind)}>
                  <option value="chat">Nachricht</option>
                  <option value="hint">Hinweis</option>
                  <option value="story">Story</option>
                </select>
              </Field>
              <Field label="Absender">
                <select value={sender} onChange={(e) => setSender(e.currentTarget.value)}>
                  {senderOptions(game).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div class="field">
              <label for="funk-text" class="sr-only">
                Text
              </label>
              <textarea
                id="funk-text"
                ref={input}
                value={body}
                maxLength={2000}
                rows={3}
                placeholder={kind === "hint" ? "Hinweis für das Team …" : "Funkspruch …"}
                onInput={(e) => setBody(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void send(e);
                }}
              />
            </div>
            {hintBlocked && <p class="small notice">Hinweise gehen an ein bestimmtes Team. Bitte oben unter „Verlauf“ ein Team wählen.</p>}
            <div class="row end">
              <span class="small muted">Strg+Enter sendet</span>
              <button type="submit" class="btn primary" disabled={busy || !body.trim() || hintBlocked}>
                <Icon name="send" /> Senden
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
