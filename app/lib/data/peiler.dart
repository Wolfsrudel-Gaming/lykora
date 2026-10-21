// Peilung nach dem Prinzip wärmer/kälter: vier Stufen statt zappelnder Meterangabe.
//
// Die Stufen haben eine Hysterese, damit sie an Grenzen nicht flackern: Eintritt bei der
// Schwelle, Austritt erst ein Stück dahinter. Die Richtung zeigt ein Lichtkegel, dessen Breite
// die Unsicherheit aus GPS-Genauigkeit und Kompass ehrlich abbildet.

import 'dart:math' as math;

enum PeilStage {
  far('weit'),
  mid('unterwegs'),
  near('nah'),
  here('hier');

  const PeilStage(this.word);
  final String word;

  /// Schlüssel für approach im Spielformat
  String get key => name;
}

class Peiler {
  Peiler({this.midEnter = 150, this.nearEnter = 60, this.margin = 10});

  final double midEnter;
  final double nearEnter;

  /// Austritt erst so viele Meter hinter der Eintrittsschwelle
  final double margin;

  String? target;
  PeilStage stage = PeilStage.far;

  /// Stufe für [distance] Meter zu [targetId]; [radius] ist der Auslöseradius der Station.
  PeilStage update(String targetId, double distance, {double radius = 20, bool triggered = false}) {
    if (targetId != target) {
      target = targetId;
      stage = _raw(distance, radius);
    }
    if (triggered) return stage = PeilStage.here;
    final raw = _raw(distance, radius);
    if (raw.index >= stage.index) return stage = raw;
    // Weiter weg: erst wechseln, wenn die Austrittsschwelle der aktuellen Stufe überschritten ist.
    final exit = switch (stage) {
      PeilStage.here => radius + margin,
      PeilStage.near => nearEnter + margin,
      PeilStage.mid => midEnter + margin * 1.5,
      PeilStage.far => double.infinity,
    };
    if (distance > exit) stage = raw;
    return stage;
  }

  PeilStage _raw(double d, double radius) {
    if (d <= radius) return PeilStage.here;
    if (d <= nearEnter) return PeilStage.near;
    if (d <= midEnter) return PeilStage.mid;
    return PeilStage.far;
  }

  void reset() {
    target = null;
    stage = PeilStage.far;
  }
}

/// Breite des Lichtkegels in Grad: je unsicherer GPS und Kompass, desto breiter. 360 heißt „Signal schwankt“.
double coneWidth({required double distance, required double? accuracy, required double compassSpread}) {
  final acc = accuracy ?? 50;
  if (acc > 40) return 360;
  if (distance <= 1) return 360;
  final gps = 2 * math.atan2(acc, distance) * 180 / math.pi;
  return (gps + compassSpread * 2).clamp(24, 360).toDouble();
}

/// Abstand grob in Worten: nah, mittel, weit.
String coarseDistance(double meters) => meters < 60 ? 'nah' : (meters < 150 ? 'mittel' : 'weit');

/// Richtung als Uhrzeit relativ zur Blickrichtung, z. B. „auf 2 Uhr“.
String clockDirection(double relativeDeg) {
  final h = ((relativeDeg % 360 + 360) % 360 / 30).round() % 12;
  return 'auf ${h == 0 ? 12 : h} Uhr';
}

/// Himmelsrichtung in Worten, z. B. „Nordosten“.
String compassWord(double deg) => const ['Norden', 'Nordosten', 'Osten', 'Südosten', 'Süden', 'Südwesten', 'Westen', 'Nordwesten'][((deg + 22.5) % 360 ~/ 45)];
