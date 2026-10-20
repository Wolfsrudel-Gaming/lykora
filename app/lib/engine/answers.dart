import 'dart:math' as math;

import '../model/game.dart';
import 'geo.dart';

enum Verdict { correct, wrong, pending }

String normalizeAnswer(String value, {required bool ignoreCase, required bool ignoreWhitespace}) {
  var v = value.trim();
  if (ignoreCase) v = v.toLowerCase();
  return ignoreWhitespace ? v.replaceAll(RegExp(r'\s+'), '') : v.replaceAll(RegExp(r'\s+'), ' ');
}

/// Levenshtein-Abstand, bricht ab, sobald max überschritten ist.
int editDistance(String a, String b, int max) {
  if ((a.length - b.length).abs() > max) return max + 1;
  var prev = List<int>.generate(b.length + 1, (i) => i);
  for (var i = 1; i <= a.length; i++) {
    final cur = <int>[i];
    var rowMin = i;
    for (var j = 1; j <= b.length; j++) {
      final v = math.min(math.min(prev[j] + 1, cur[j - 1] + 1), prev[j - 1] + (a[i - 1] == b[j - 1] ? 0 : 1));
      cur.add(v);
      rowMin = math.min(rowMin, v);
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/// Erlaubte Tippfehler hängen von der Länge ab, damit kurze Antworten nicht beliebig werden.
int _allowedTypos(String answer, int maxTypos) {
  if (answer.length <= 3) return 0;
  if (answer.length <= 6) return math.min(maxTypos, 1);
  return maxTypos;
}

/// Prüft eine Antwort. [input] hat dieselben Felder wie die Payload einer answer-Aktion.
Verdict checkAnswer(Task task, Json input, {List<String> memberTags = const []}) {
  switch (task.type) {
    case 'text':
      final text = input['text'];
      if (text is! String) return Verdict.wrong;
      if (task.manualReview) return Verdict.pending;
      final m = task.json['match'] as Json? ?? {};
      final ignoreCase = m['ignoreCase'] as bool? ?? true;
      final ignoreWhitespace = m['ignoreWhitespace'] as bool? ?? true;
      final maxTypos = (m['maxTypos'] as num?)?.toInt() ?? 1;
      final given = normalizeAnswer(text, ignoreCase: ignoreCase, ignoreWhitespace: ignoreWhitespace);
      final ok = task.answers.any((a) {
        final want = normalizeAnswer(a, ignoreCase: ignoreCase, ignoreWhitespace: ignoreWhitespace);
        final allowed = _allowedTypos(want, maxTypos);
        return editDistance(given, want, allowed) <= allowed;
      });
      return ok ? Verdict.correct : Verdict.wrong;
    case 'code':
      final text = input['text'];
      if (text is! String) return Verdict.wrong;
      return task.answers.any((a) => a.trim() == text.trim()) ? Verdict.correct : Verdict.wrong;
    case 'choice':
      final choice = input['choice'];
      if (choice is! List) return Verdict.wrong;
      final want = [for (var i = 0; i < task.options.length; i++) if (task.options[i]['correct'] == true) i];
      final given = choice.cast<num>().map((n) => n.toInt()).toSet().toList()..sort();
      if (given.length != want.length) return Verdict.wrong;
      for (var i = 0; i < want.length; i++) {
        if (given[i] != want[i]) return Verdict.wrong;
      }
      return Verdict.correct;
    case 'photo':
      if (input['upload'] is! String) return Verdict.wrong;
      return task.review == 'auto_accept' ? Verdict.correct : Verdict.pending;
    case 'find_location':
      final loc = input['location'];
      if (loc is! Map) return Verdict.wrong;
      final target = GeoPoint.fromJson(task.json['location'] as Json);
      final tolerance = (task.json['radius'] as num?)?.toDouble() ?? 20;
      final slack = math.min((loc['accuracy'] as num?)?.toDouble() ?? 0, tolerance);
      return distance(GeoPoint.fromJson(loc.cast<String, dynamic>()), target) <= tolerance + slack ? Verdict.correct : Verdict.wrong;
    case 'wristband':
      final tags = input['tags'];
      if (tags is! List) return Verdict.wrong;
      final scanned = tags.whereType<String>().where(memberTags.contains).toSet();
      final count = task.json['count'];
      final needed = count == null || count == 'all' ? memberTags.length : (count as num).toInt();
      return needed > 0 && scanned.length >= needed ? Verdict.correct : Verdict.wrong;
    default:
      // Unbekannter Aufgabentyp aus einer neueren Formatversion: der Server entscheidet.
      return Verdict.pending;
  }
}
