// Sperrzonen und Spielfeldgrenze: Eintritt und Austritt mit Hysterese statt Alarm bei jedem GPS-Zucken.
//
// Straßen sind die typischen Sperrzonen und liegen oft neben dem Weg. Ein einzelner Fix darf deshalb weder
// das Vollbild auslösen noch zurücknehmen. Die Schwellen stehen hier als Konstanten; das Spielformat trägt sie nicht.

import '../model/game.dart';
import 'geo.dart';

/// So viele Fixes in Folge müssen sicher in der Zone liegen, bevor das Vollbild kommt.
const zoneEnterFixes = 2;

/// Schlechter als so viele Meter: Der Fix löst kein Vollbild aus, es gibt nur den Hinweis „Ortung ungenau“.
const zoneMaxAccuracy = 50.0;

/// Austritt aus der Zone erst ab so viel Abstand zur Kante …
const zoneLeaveMargin = 10.0;

/// … oder wenn die Fixes so lange (ms) durchgehend außerhalb lagen.
const zoneLeaveHold = 10000;

/// Alarm (Ton, Vibration, Durchsage) für dieselbe Zone frühestens nach so vielen ms wieder.
const zoneRepeatCooldown = 30000;

/// Warnung zu einer Sperrzone oder zur Spielfeldgrenze.
class ZoneAlert {
  ZoneAlert(this.message, {required this.inside, this.zone, this.distance = 0, this.uncertain = false});
  final String message;

  /// Sicher in der Zone: Stufe A, Vollbild
  final bool inside;

  /// Die Sperrzone; null heißt Spielfeldgrenze
  final RestrictedZone? zone;

  /// Abstand zur Zone in Metern, 0 wenn drin
  final double distance;

  /// Die Ortung ist zu ungenau, um zu wissen, ob das Team in der Zone steht; nur Hinweis, nie Vollbild.
  final bool uncertain;

  bool get boundary => zone == null;
}

/// Ergebnis eines Fixes: der Stand für die Anzeige und die Alarme, die dabei neu fällig wurden.
class ZoneUpdate {
  const ZoneUpdate(this.alert, this.alarms);
  final ZoneAlert? alert;

  /// zone_inside oder zone_near, je höchstens einmal je Zone und Abklingzeit
  final List<String> alarms;
}

enum _Level { clear, near, inside }

class _Track {
  _Level level = _Level.clear;

  /// Aufeinanderfolgende sichere Fixes in der Zone
  int streak = 0;

  /// Seit wann die Fixes durchgehend außerhalb liegen, solange der Zustand „drin“ ist
  int? outSince;
  int? lastInsideAlarm;
  int? lastNearAlarm;
}

/// Wertet Fixes gegen Sperrzonen und Spielfeldgrenze aus und merkt sich den Zustand je Zone.
class ZoneTracker {
  ZoneTracker({
    this.enterFixes = zoneEnterFixes,
    this.maxAccuracy = zoneMaxAccuracy,
    this.leaveMargin = zoneLeaveMargin,
    this.leaveHold = zoneLeaveHold,
    this.cooldown = zoneRepeatCooldown,
  });

  final int enterFixes;
  final double maxAccuracy;
  final double leaveMargin;
  final int leaveHold;
  final int cooldown;

  final _tracks = <String, _Track>{};
  static const _boundary = '\u0000boundary';

  void reset() => _tracks.clear();

  /// Wertet einen Fix aus. [now] in ms, [accuracy] in Metern.
  ZoneUpdate update(Game game, GeoPoint position, double accuracy, int now) {
    final reliable = accuracy <= maxAccuracy;
    final alarms = <String>[];
    ZoneAlert? inside;
    ZoneAlert? uncertain;
    ZoneAlert? near;

    for (final z in game.field.restrictedZones) {
      final track = _tracks.putIfAbsent(z.id, _Track.new);
      final d = distanceToArea(position, z.area);
      final name = z.name.resolve(game.language);

      if (track.level == _Level.inside) {
        if (d == 0) {
          track.outSince = null;
        } else {
          track.outSince ??= now;
          final gone = d >= leaveMargin || now - track.outSince! >= leaveHold;
          // Ein ungenauer Fix beweist den Austritt nicht, solange die Kante noch in seinem Fehlerkreis liegt.
          if (gone && (reliable || d >= accuracy + leaveMargin)) {
            track.level = _Level.clear;
            track.outSince = null;
          }
        }
      } else {
        track.streak = d == 0 && reliable ? track.streak + 1 : 0;
        if (track.streak >= enterFixes) {
          track.level = _Level.inside;
          track.streak = 0;
          if (_due(track.lastInsideAlarm, now)) {
            track.lastInsideAlarm = now;
            alarms.add('zone_inside');
          }
        }
      }

      if (track.level == _Level.inside) {
        inside ??= ZoneAlert('Ihr seid in der Sperrzone „$name“. Geht sofort zurück.', inside: true, zone: z);
        continue;
      }
      // Nah: Eintritt bei der Warnschwelle, Austritt erst ein Stück dahinter.
      final warn = z.warnDistance + (track.level == _Level.near ? leaveMargin : 0);
      if (d <= warn) {
        if (track.level != _Level.near && _due(track.lastNearAlarm, now)) {
          track.lastNearAlarm = now;
          alarms.add('zone_near');
        }
        track.level = _Level.near;
      } else {
        track.level = _Level.clear;
      }
      if (!reliable && d <= accuracy) {
        uncertain ??= ZoneAlert('Ortung ungenau (±${accuracy.round()} m). Haltet Abstand zu „$name“.', inside: false, zone: z, distance: d, uncertain: true);
      } else if (track.level == _Level.near && (near == null || d < near.distance)) {
        near = ZoneAlert(
          d == 0 ? 'Achtung: $name ist ganz nah. Umkehren.' : 'Achtung: $name in ${d.round()} m. Umkehren.',
          inside: false,
          zone: z,
          distance: d,
        );
      }
    }

    // Die Grenze läuft immer mit, damit ihre Zählung stimmt; gemeldet wird sie nur, wenn keine Zone wichtiger ist.
    final boundaryAlarms = <String>[];
    final boundary = _boundaryAlert(game, position, accuracy, reliable, now, boundaryAlarms);
    final alert = inside ?? uncertain ?? near;
    if (alert == null) alarms.addAll(boundaryAlarms);
    return ZoneUpdate(alert ?? boundary, alarms);
  }

  ZoneAlert? _boundaryAlert(Game game, GeoPoint position, double accuracy, bool reliable, int now, List<String> alarms) {
    final track = _tracks.putIfAbsent(_boundary, _Track.new);
    final out = distanceToArea(position, game.field.boundary);
    // Draußen zählt nur, was der Fehlerkreis nicht erklärt.
    final surelyOut = out > 0 && (reliable || out > accuracy);
    if (track.level == _Level.near) {
      if (out == 0) {
        track.outSince ??= now;
        if (now - track.outSince! >= leaveHold) track.level = _Level.clear;
      } else {
        track.outSince = null;
      }
    } else {
      track.streak = surelyOut ? track.streak + 1 : 0;
      if (track.streak >= enterFixes) {
        track.level = _Level.near;
        track.streak = 0;
        track.outSince = null;
        if (_due(track.lastNearAlarm, now)) {
          track.lastNearAlarm = now;
          alarms.add('zone_near');
        }
      }
    }
    if (track.level != _Level.near) return null;
    return ZoneAlert('Ihr verlasst das Spielfeld. Umkehren.', inside: false, distance: out);
  }

  bool _due(int? last, int now) => last == null || now - last >= cooldown;
}
