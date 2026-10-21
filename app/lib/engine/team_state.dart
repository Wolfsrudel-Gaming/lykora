// Spielstand eines Teams, berechnet aus seinem Aktionsprotokoll.
//
// Gegenstück zu server/src/engine/team.ts. Beide müssen sich gleich verhalten;
// die gemeinsamen Testfälle in spec/test-vectors/engine.json sichern das ab.

import 'dart:math' as math;

import '../model/game.dart';
import 'answers.dart';
import 'geo.dart';

class EngineAction {
  EngineAction({required this.clientId, required this.type, required this.payload, required this.time, this.source = 'team', this.seq = 0});

  final String clientId;
  final String type;
  final Json payload;

  /// Zeitpunkt in ms seit Epoche
  final int time;
  final String source;

  /// Reihenfolge des Eingangs, entscheidet bei gleichem Zeitstempel
  final int seq;
}

class Outcome {
  Outcome(this.clientId);
  final String clientId;
  String status = 'ok';
  String? reason;
  Verdict? verdict;

  bool get ok => status == 'ok';
}

class GeneratedMessage {
  GeneratedMessage(this.key, this.from, this.text, this.time);
  final String key;
  final String from;
  final LText text;
  final int time;
}

class Pause {
  const Pause(this.from, this.to);
  final int from;
  final int? to;
}

class TeamContext {
  TeamContext({required this.game, required this.eventStartedAt, this.pauses = const [], this.endedAt, this.blockReason});

  final Game game;
  final int? eventStartedAt;
  final List<Pause> pauses;
  final int? endedAt;
  final String? blockReason;
}

class TeamState {
  int? startedAt;
  int? finishedAt;
  final List<String> triggered = [];
  final Map<String, int> solved = {};
  final List<String> revealed = [];
  final List<String> locked = [];
  final List<String> fragments = [];
  final List<String> items = [];
  final List<String> chapters = [];
  final Map<String, int> hints = {};
  int hintsUsed = 0;
  int wrongAnswers = 0;
  int points = 0;

  /// Zeitstrafen in Sekunden
  int timePenalty = 0;
  int? lockedUntil;
  final List<String> pendingReviews = [];
  final List<String> firedRules = [];
  final List<GeneratedMessage> messages = [];
  final List<Outcome> outcomes = [];

  Outcome? outcome(String clientId) {
    for (final o in outcomes) {
      if (o.clientId == clientId) return o;
    }
    return null;
  }
}

int pausedBetween(List<Pause> pauses, int from, int to) {
  var total = 0;
  for (final p in pauses) {
    final a = math.max(p.from, from);
    final b = math.min(p.to ?? to, to);
    if (b > a) total += b - a;
  }
  return total;
}

/// Spielzeit in Sekunden zum Zeitpunkt t, ohne Pausen und ohne Strafen.
double elapsedAt(TeamContext ctx, TeamState state, int t) {
  final start = ctx.game.settings.timeLimit == 'global' ? (ctx.eventStartedAt ?? state.startedAt) : state.startedAt;
  if (start == null) return 0;
  return math.max(0, (t - start - pausedBetween(ctx.pauses, start, t)) / 1000);
}

/// Restzeit in Sekunden inklusive Strafen; null ohne Zeitlimit.
double? remainingAt(TeamContext ctx, TeamState state, int t) {
  final s = ctx.game.settings;
  if (s.timeLimit == 'none' || s.duration == null || state.startedAt == null && s.timeLimit != 'global') return null;
  return s.duration! - elapsedAt(ctx, state, t) - state.timePenalty;
}

bool _isTimeUp(TeamContext ctx, TeamState state, int t) {
  final s = ctx.game.settings;
  if (s.timeLimit == 'none' || s.duration == null) return false;
  return elapsedAt(ctx, state, t) + state.timePenalty > s.duration!;
}

String? _gateReason(TeamContext ctx, int t) {
  if (ctx.blockReason != null) return ctx.blockReason;
  if (ctx.eventStartedAt == null || t < ctx.eventStartedAt!) return 'not_started';
  if (ctx.endedAt != null && t > ctx.endedAt!) return 'ended';
  if (ctx.pauses.any((p) => t >= p.from && (p.to == null || t < p.to!))) return 'paused';
  return null;
}

List<EngineAction> sortActions(List<EngineAction> actions) {
  final list = [...actions];
  list.sort((a, b) {
    final c = a.time.compareTo(b.time);
    return c != 0 ? c : a.seq.compareTo(b.seq);
  });
  return list;
}

void _add(List<String> list, String value) {
  if (!list.contains(value)) list.add(value);
}

const _noStation = {'staff_points', 'staff_time', 'staff_item'};
const _passive = {'heartbeat', 'arrived'};

TeamState reduceTeam(TeamContext ctx, List<EngineAction> actions) {
  final game = ctx.game;
  final state = TeamState();
  var streak = 0;
  var cleanSinceLastSolve = true;
  GeoPoint? lastLocation;

  bool allFragments() => game.fragments.every((f) => state.fragments.contains(f.id));

  bool isAvailable(Station s) => !state.locked.contains(s.id) && (!s.hidden || state.revealed.contains(s.id)) && (!s.isFinal || allFragments());

  void applyPenalty(Penalty? penalty, int t) {
    if (penalty == null) return;
    switch (penalty.type) {
      case 'time':
        state.timePenalty += penalty.amount;
      case 'points':
        state.points -= penalty.amount;
      case 'lockout':
        state.lockedUntil = math.max(state.lockedUntil ?? 0, t + penalty.amount * 1000);
    }
  }

  bool conditionHolds(Json c, int t) {
    if (c.containsKey('station_solved')) return state.solved.containsKey(c['station_solved']);
    if (c.containsKey('has_item')) return state.items.contains(c['has_item']);
    if (c.containsKey('fragments_collected')) return state.fragments.length >= (c['fragments_collected'] as num);
    if (c.containsKey('elapsed')) return elapsedAt(ctx, state, t) >= (c['elapsed'] as num);
    if (c.containsKey('near')) {
      final near = c['near'] as Json;
      return lastLocation != null && distance(lastLocation, GeoPoint.fromJson(near['location'] as Json)) <= (near['radius'] as num);
    }
    return false;
  }

  void runRuleActions(String ruleId, List<Json> list, String branch, int t) {
    for (var i = 0; i < list.length; i++) {
      final a = list[i];
      if (a.containsKey('reveal_station')) {
        _add(state.revealed, a['reveal_station'] as String);
      } else if (a.containsKey('give_item')) {
        _add(state.items, a['give_item'] as String);
      } else if (a.containsKey('add_points')) {
        state.points += (a['add_points'] as num).toInt();
      } else if (a.containsKey('start_chapter')) {
        _add(state.chapters, a['start_chapter'] as String);
      } else if (a.containsKey('message')) {
        final m = a['message'] as Json;
        state.messages.add(GeneratedMessage('rule:$ruleId:$branch:$i', m['from'] as String? ?? 'hq', LText(m['text']), t));
      }
    }
  }

  // „Sonst“ greift, wenn die erste Bedingung erfüllt ist, aber nicht alle.
  void evaluateRules(int t) {
    var changed = true;
    var guard = 0;
    while (changed && guard++ < 20) {
      changed = false;
      for (final rule in game.rules) {
        final id = rule['id'] as String;
        final once = rule['once'] as bool? ?? true;
        if (once && state.firedRules.contains(id)) continue;
        final when = (rule['when'] as List).cast<Json>();
        final results = when.map((c) => conditionHolds(c, t)).toList();
        final elseList = (rule['else'] as List? ?? const []).cast<Json>();
        if (results.every((r) => r)) {
          runRuleActions(id, (rule['then'] as List).cast<Json>(), 'then', t);
        } else if (elseList.isNotEmpty && results.first) {
          runRuleActions(id, elseList, 'else', t);
        } else {
          continue;
        }
        _add(state.firedRules, id);
        changed = once;
      }
    }
  }

  void solve(Station s, int t, bool clean) {
    if (state.solved.containsKey(s.id)) return;
    state.solved[s.id] = t;
    state.pendingReviews.remove(s.id);
    final r = s.rewards;
    state.points += (r['points'] as num?)?.toInt() ?? game.settings.solvePoints;
    streak = clean ? streak + 1 : 0;
    if (streak > 1) state.points += game.settings.streakBonus;
    for (final f in (r['fragments'] as List? ?? const []).cast<String>()) {
      _add(state.fragments, f);
    }
    for (final i in (r['items'] as List? ?? const []).cast<String>()) {
      _add(state.items, i);
    }
    for (final st in (r['reveal'] as List? ?? const []).cast<String>()) {
      _add(state.revealed, st);
    }
    if (r['chapter'] is String) _add(state.chapters, r['chapter'] as String);
    if (s.isFinal && state.finishedAt == null) state.finishedAt = t;
  }

  for (final action in sortActions(actions)) {
    final t = action.time;
    final p = action.payload;
    final out = Outcome(action.clientId);
    state.outcomes.add(out);
    void reject(String reason) {
      out.status = 'rejected';
      out.reason = reason;
    }

    void ignore(String reason) {
      out.status = 'ignored';
      out.reason = reason;
    }

    final loc = p['location'];
    if (loc is Map && loc['lat'] is num) lastLocation = GeoPoint.fromJson(loc.cast<String, dynamic>());

    if (action.source == 'team') {
      if (_passive.contains(action.type)) continue;
      final gate = _gateReason(ctx, t);
      if (gate != null) {
        reject(gate);
        continue;
      }
      state.startedAt ??= t;
      if (action.type == 'start') continue;
      if (state.finishedAt != null) {
        ignore('finished');
        continue;
      }
      if (_isTimeUp(ctx, state, t)) {
        reject('time_up');
        continue;
      }
    }

    final station = p['station'] is String ? game.station(p['station'] as String) : null;
    if (!_noStation.contains(action.type) && station == null) {
      reject('unknown_station');
      continue;
    }

    switch (action.type) {
      case 'trigger':
        final s = station!;
        final byProximity = s.hidden && s.revealRadius != null && p['method'] == 'gps';
        if (byProximity) _add(state.revealed, s.id);
        if (!isAvailable(s)) {
          reject(state.locked.contains(s.id) ? 'locked' : (s.isFinal ? 'fragments_missing' : 'hidden'));
        } else if (state.triggered.contains(s.id)) {
          ignore('already_triggered');
        } else {
          state.triggered.add(s.id);
        }
      case 'answer':
        final s = station!;
        final task = s.task;
        if (task == null) {
          reject('no_task');
        } else if (!state.triggered.contains(s.id)) {
          reject('not_triggered');
        } else if (state.solved.containsKey(s.id)) {
          ignore('already_solved');
        } else if (state.pendingReviews.contains(s.id)) {
          ignore('review_pending');
        } else if (state.lockedUntil != null && t < state.lockedUntil!) {
          reject('locked_out');
        } else {
          final verdict = checkAnswer(task, p);
          out.verdict = verdict;
          switch (verdict) {
            case Verdict.correct:
              solve(s, t, cleanSinceLastSolve);
              cleanSinceLastSolve = true;
            case Verdict.pending:
              _add(state.pendingReviews, s.id);
            case Verdict.wrong:
              state.wrongAnswers++;
              cleanSinceLastSolve = false;
              applyPenalty(game.settings.wrongAnswer, t);
          }
        }
      case 'hint':
        final s = station!;
        final used = state.hints[s.id] ?? 0;
        final level = (p['level'] as num?)?.toInt() ?? used + 1;
        if (!game.settings.hintsEnabled) {
          reject('hints_disabled');
        } else if (level <= used) {
          ignore('already_used');
        } else if (level != used + 1 || level > s.hints.length) {
          reject('invalid_level');
        } else {
          state.hints[s.id] = level;
          state.hintsUsed++;
          cleanSinceLastSolve = false;
          final defaults = game.settings.defaultHintCost;
          applyPenalty(s.hints[level - 1].cost ?? (level - 1 < defaults.length ? defaults[level - 1] : null), t);
        }
      case 'staff_reveal':
        _add(state.revealed, station!.id);
        state.locked.remove(station.id);
      case 'staff_lock':
        _add(state.locked, station!.id);
      case 'staff_unlock':
        state.locked.remove(station!.id);
        _add(state.revealed, station.id);
      case 'staff_solve':
        _add(state.triggered, station!.id);
        solve(station, t, false);
      case 'staff_reject':
        state.pendingReviews.remove(station!.id);
      case 'staff_points':
        state.points += (p['amount'] as num?)?.toInt() ?? 0;
      case 'staff_time':
        state.timePenalty += (p['seconds'] as num?)?.toInt() ?? 0;
      case 'staff_item':
        final item = p['item'];
        if (item is! String) {
          reject('unknown_item');
        } else if (p['remove'] == true) {
          state.items.remove(item);
        } else {
          _add(state.items, item);
        }
      default:
        reject('unknown_type');
    }

    if (out.ok) evaluateRules(t);
  }
  return state;
}
