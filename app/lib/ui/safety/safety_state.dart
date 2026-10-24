// Reine Hilfen der Sicherheitsoberfläche: was auf Versand wartet, wie alt die Ortung ist und wann die
// letzte Verbindung zur Spielleitung bestand. Ohne Widgets, damit Leiste, SOS-Seite und Notfallseite
// dasselbe sagen.

import 'package:url_launcher/url_launcher.dart';

import '../../data/controller.dart';

/// Ohne Verbindung so lange: Die Telefonnummer der Spielleitung steht groß da, denn ein Rückruf oder eine
/// Lebenszeichen-Frage kommt nur mit Netz an.
const noContactAfter = Duration(minutes: 15);

/// Ab dieser Zeit seit dem letzten Abgleich nennt die Leiste das Alter der Verbindung.
const contactNoticeAfter = Duration(minutes: 1);

/// Anzahl der Dinge, die noch auf Versand warten: Aktionen, SOS, Nachrichten und Fotos.
int queuedCount(GameController c) {
  final s = c.session;
  final messages = s?.messages.where((m) => m.pending && !m.failed).length ?? 0;
  return c.unsyncedCount + c.sosQueueLength + messages + (s?.pendingUploads.length ?? 0);
}

/// Hinweis zur Ortung, wenn das letzte Signal alt ist oder fehlt; null, solange alles frisch ist.
String? positionHint(GameController c) {
  final age = c.positionAge;
  if (c.position == null || age == null) {
    return c.locationError == null ? 'Keine Ortung. Noch kein Standort empfangen.' : 'Keine Ortung. Ist der Standort eingeschaltet?';
  }
  if (!c.positionStale && c.locationError == null) return null;
  final since = spanText(age);
  return _sentence(c.locationError == null ? 'Ortung veraltet seit $since.' : 'Keine Ortung. Letzte Position von vor $since.');
}

/// Kurzform für die Leiste: „Keine Ortung“ oder „Ortung veraltet“; null, solange alles frisch ist.
String? positionShort(GameController c) {
  if (positionHint(c) == null) return null;
  return c.position == null || c.locationError != null ? 'Keine Ortung' : 'Ortung veraltet';
}

/// „7 Min..“ wird „7 Min.“: Der Punkt der Abkürzung ist zugleich der Satzpunkt.
String _sentence(String s) => s.replaceAll('.. ', '. ').replaceAll(RegExp(r'\.\.$'), '.');

/// Satz mit Dauer am Ende: der Punkt von „Min.“ steht nur einmal.
String sentenceEnd(String s) => _sentence(s);

/// Dauer als Kurztext: „25 s“, „7 Min.“, „2 Std. 5 Min.“.
String spanText(Duration d) {
  if (d.inMinutes < 1) return '${d.inSeconds} s';
  if (d.inMinutes < 120) return '${d.inMinutes} Min.';
  return '${d.inHours} Std. ${d.inMinutes % 60} Min.';
}

/// Uhrzeit des Handys in ms; so rechnen die Zeitstempel des Controllers (Abgleich, Sendeversuche).
int deviceNowMs(GameController c) => c.now() - (c.session?.clockOffsetMs ?? 0);

/// Wie lange der letzte gelungene Abgleich mit der Spielleitung her ist; null, solange noch keiner gelang.
Duration? contactAge(GameController c) {
  final last = c.session?.lastSyncAt;
  if (last == null) return null;
  final ms = deviceNowMs(c) - last.millisecondsSinceEpoch;
  return Duration(milliseconds: ms < 0 ? 0 : ms);
}

/// „Zuletzt Verbindung vor 12 Min.“; null, solange kein Abgleich gelang.
String? contactText(GameController c) {
  final age = contactAge(c);
  if (age == null) return null;
  if (age.inMinutes < 1) return 'Zuletzt Verbindung gerade eben.';
  return _sentence('Zuletzt Verbindung vor ${spanText(age)}.');
}

/// Seit [noContactAfter] keine Verbindung: Die Telefonnummer der Spielleitung gehört groß ins Bild.
bool contactLost(GameController c) => (contactAge(c) ?? Duration.zero) >= noContactAfter;

/// Sekunden bis zum nächsten Sendeversuch eines wartenden SOS; null, wenn keiner geplant ist.
int? secondsToNextAttempt(GameController c, SosInfo? info) {
  final next = info?.nextAttemptAt;
  if (next == null) return null;
  final ms = next.millisecondsSinceEpoch - deviceNowMs(c);
  return ms <= 0 ? 0 : (ms / 1000).ceil();
}

/// Ruft die Nummer an. Ohne Telefon-App passiert nichts; die Nummer steht immer auch im Text.
Future<void> dial(String number) async {
  try {
    await launchUrl(Uri(scheme: 'tel', path: number.replaceAll(' ', '')));
  } catch (_) {}
}

/// Öffnet die SMS-App mit fertigem Text.
Future<void> textMessage(String number, String body) async {
  try {
    await launchUrl(Uri.parse('sms:${number.replaceAll(' ', '')}?body=${Uri.encodeComponent(body)}'));
  } catch (_) {}
}
