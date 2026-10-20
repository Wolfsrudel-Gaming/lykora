// Prüft die Dart-Engine gegen die gemeinsamen Testfälle in spec/test-vectors/engine.json.
// Dieselben Fälle laufen im Server (server/test/vectors.test.ts).

import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:lykora/engine/team_state.dart';
import 'package:lykora/model/game.dart';

final _vectorsFile = File('../spec/test-vectors/engine.json');

void _applyPatch(Json target, String path, Object? value) {
  final parts = path.split('.');
  dynamic obj = target;
  for (var i = 0; i < parts.length; i++) {
    final part = parts[i];
    final last = i == parts.length - 1;
    final m = RegExp(r'^(\w+)\[(.+)\]$').firstMatch(part);
    if (m != null) {
      obj = (obj[m.group(1)] as List).firstWhere((x) => x['id'] == m.group(2));
    } else if (last) {
      obj[part] = value;
    } else {
      obj = (obj as Map).putIfAbsent(part, () => <String, dynamic>{});
    }
  }
}

List<String> _sorted(Iterable<String> v) => [...v]..sort();

void main() {
  final vectors = jsonDecode(_vectorsFile.readAsStringSync()) as Json;
  final gameFile = File.fromUri(_vectorsFile.absolute.uri.resolve(vectors['game'] as String));
  final baseGame = gameFile.readAsStringSync();
  final t0 = DateTime.parse(vectors['t0'] as String).millisecondsSinceEpoch;
  int at(num min) => t0 + (min * 60000).round();

  group('gemeinsame Engine-Testfälle', () {
    for (final c in (vectors['cases'] as List).cast<Json>()) {
      test(c['name'], () {
        final json = jsonDecode(baseGame) as Json;
        for (final p in (c['patch'] as List? ?? const []).cast<Json>()) {
          _applyPatch(json, p['path'] as String, p['value']);
        }
        final cx = c['ctx'] as Json? ?? {};
        final ctx = TeamContext(
          game: Game(json),
          eventStartedAt: at(cx['eventStartedAt'] as num? ?? 0),
          endedAt: cx['endedAt'] == null ? null : at(cx['endedAt'] as num),
          pauses: [for (final p in (cx['pauses'] as List? ?? const [])) Pause(at(p[0] as num), p[1] == null ? null : at(p[1] as num))],
          blockReason: cx['blockReason'] as String?,
          staffTags: (cx['staffTags'] as List? ?? const []).cast<String>(),
          memberTags: (cx['memberTags'] as List? ?? const []).cast<String>(),
        );
        final raw = (c['actions'] as List).cast<List>();
        final actions = [
          for (var i = 0; i < raw.length; i++)
            EngineAction(
              clientId: 'a$i',
              time: at(raw[i][0] as num),
              type: raw[i][1] as String,
              payload: (raw[i][2] as Map).cast<String, dynamic>(),
              source: raw[i].length > 3 ? raw[i][3] as String : 'team',
              seq: i,
            ),
        ];
        final state = reduceTeam(ctx, actions);
        final e = c['expect'] as Json;
        final outs = actions.map((a) => state.outcome(a.clientId)!).toList();
        if (e['outcomes'] != null) {
          expect(outs.map((o) => o.ok ? 'ok' : '${o.status}:${o.reason}').toList(), e['outcomes']);
        }
        if (e['verdicts'] != null) expect(outs.map((o) => o.verdict?.name).toList(), e['verdicts']);
        if (e['solved'] != null) expect(_sorted(state.solved.keys), _sorted((e['solved'] as List).cast()));
        if (e['fragments'] != null) expect(_sorted(state.fragments), _sorted((e['fragments'] as List).cast()));
        if (e['items'] != null) expect(_sorted(state.items), _sorted((e['items'] as List).cast()));
        if (e['revealed'] != null) expect(_sorted(state.revealed), _sorted((e['revealed'] as List).cast()));
        if (e['points'] != null) expect(state.points, e['points']);
        if (e['timePenalty'] != null) expect(state.timePenalty, e['timePenalty']);
        if (e['hintsUsed'] != null) expect(state.hintsUsed, e['hintsUsed']);
        if (e['wrongAnswers'] != null) expect(state.wrongAnswers, e['wrongAnswers']);
        if (e['pendingReviews'] != null) expect(state.pendingReviews, e['pendingReviews']);
        if (e.containsKey('finishedAt')) expect(state.finishedAt, e['finishedAt'] == null ? null : at(e['finishedAt'] as num));
        if (e['messages'] != null) expect(state.messages.map((m) => m.key).toList(), e['messages']);
      });
    }
  });
}
