import 'package:flutter/material.dart';

import '../design/tokens.dart';

String formatDuration(double seconds) {
  final s = seconds.abs().round();
  final h = s ~/ 3600;
  final m = (s % 3600) ~/ 60;
  final sec = s % 60;
  final mm = m.toString().padLeft(2, '0');
  final ss = sec.toString().padLeft(2, '0');
  return '${seconds < 0 ? '−' : ''}${h > 0 ? '$h:' : ''}$mm:$ss';
}

/// Restzeit grob, wie man sie sich im Wald merkt: „~ 40 Min.“; in den letzten 10 Minuten genau.
String coarseTime(double seconds) {
  if (seconds <= 0) return 'Zeit um';
  if (seconds <= 600) return formatDuration(seconds);
  final min = (seconds / 60 / 5).round() * 5;
  return min >= 60 ? '~ ${min ~/ 60} Std. ${min % 60 == 0 ? '' : '${min % 60} Min.'}'.trim() : '~ $min Min.';
}

/// Kurzer Hinweis unten. Fehler sind nie rot: Rot gehört der Sicherheit.
void showMessage(BuildContext context, String text, {bool error = false}) {
  final t = context.tok;
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(
      SnackBar(
        content: Row(
          children: [
            Icon(error ? Icons.info_outline_rounded : Icons.check_rounded, color: error ? t.p.text : t.p.accent),
            const SizedBox(width: 12),
            Expanded(child: Text(text, style: t.body.copyWith(fontSize: 18))),
          ],
        ),
      ),
    );
}

/// Übersetzt Ablehnungsgründe der Engine in verständliche Sätze.
String reasonText(String? reason) => switch (reason) {
  'not_started' => 'Das Spiel hat noch nicht begonnen.',
  'paused' => 'Das Spiel ist gerade pausiert.',
  'ended' => 'Das Spiel ist vorbei.',
  'time_up' => 'Die Zeit ist abgelaufen.',
  'supervisor_required' => 'Ohne Betreuer geht es nicht los. Betreuer-PIN eingeben.',
  'hidden' => 'Diese Station ist noch nicht freigeschaltet.',
  'locked' => 'Diese Station ist gesperrt.',
  'fragments_missing' => 'Erst alle Teile des Codes sammeln.',
  'not_triggered' => 'Erst die Station finden.',
  'locked_out' => 'Das Schloss klemmt kurz. Gleich nochmal versuchen.',
  'already_solved' => 'Schon gelöst.',
  'already_triggered' => 'Station ist schon offen.',
  'review_pending' => 'Wartet auf Prüfung durch die Spielleitung.',
  'finished' => 'Ihr seid schon im Ziel.',
  'hints_disabled' => 'Tipps sind in diesem Spiel aus.',
  'invalid_level' => 'Keine weiteren Tipps.',
  _ => 'Das hat nicht geklappt.',
};
