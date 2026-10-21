// Prüft die Kontraste aller Lichtmodi und Spielwelten nach der WCAG-Formel.

import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lykora/data/peiler.dart';
import 'package:lykora/ui/design/tokens.dart';

double _lum(Color c) {
  double ch(double v) => v <= 0.03928 ? v / 12.92 : math.pow((v + 0.055) / 1.055, 2.4).toDouble();
  return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
}

double contrast(Color a, Color b) {
  final la = _lum(a), lb = _lum(b);
  return (math.max(la, lb) + 0.05) / (math.min(la, lb) + 0.05);
}

void main() {
  group('Kontraste', () {
    for (final mode in LightMode.values) {
      for (final genre in Genre.values) {
        test('${mode.name} · ${genre.name}', () {
          final p = paletteFor(mode, genre);
          // Rotlicht hat nur eine Rotstufe; Text ist dort größer und kräftiger.
          final body = mode == LightMode.red ? 4.5 : 7.0;
          expect(contrast(p.text, p.ground), greaterThanOrEqualTo(body), reason: 'Text auf Grund');
          expect(contrast(p.text, p.surface), greaterThanOrEqualTo(4.5), reason: 'Text auf Fläche');
          expect(contrast(p.textMuted, p.surface), greaterThanOrEqualTo(4.5), reason: 'Nebentext auf Fläche');
          expect(contrast(p.onAccent, p.accent), greaterThanOrEqualTo(4.5), reason: 'Haupthandlung');
          expect(contrast(p.accent, p.ground), greaterThanOrEqualTo(3), reason: 'Akzent als Rand und Form');
          expect(contrast(p.edge, p.ground), greaterThanOrEqualTo(3), reason: 'Ränder von Bedienelementen');
          expect(contrast(p.onSafety, p.safety), greaterThanOrEqualTo(4.5), reason: 'SOS-Schrift');
          expect(contrast(p.tapeA, p.tapeB), greaterThanOrEqualTo(3), reason: 'Absperrband');
        });
      }
    }

    test('keine Spielwelt benutzt das Sicherheitsrot', () {
      for (final g in genreStyles.values) {
        final dr = (g.accent.r - safetyRed.r).abs(), dg = (g.accent.g - safetyRed.g).abs(), db = (g.accent.b - safetyRed.b).abs();
        expect(dr + dg + db, greaterThan(0.4));
      }
    });
  });

  group('Peiler', () {
    test('Stufen mit Hysterese', () {
      final p = Peiler();
      expect(p.update('a', 400), PeilStage.far);
      expect(p.update('a', 140), PeilStage.mid);
      expect(p.update('a', 155), PeilStage.mid, reason: 'Austritt erst nach 165 m');
      expect(p.update('a', 170), PeilStage.far);
      expect(p.update('a', 55), PeilStage.near);
      expect(p.update('a', 65), PeilStage.near, reason: 'Austritt erst nach 70 m');
      expect(p.update('a', 18, radius: 20), PeilStage.here);
      expect(p.update('a', 26, radius: 20), PeilStage.here, reason: 'Austritt erst nach 30 m');
      expect(p.update('a', 31, radius: 20), PeilStage.near);
      expect(p.update('b', 31, radius: 20), PeilStage.near, reason: 'Neues Ziel startet ohne Altlast');
      expect(p.update('b', 300, triggered: true), PeilStage.here);
    });

    test('Kegel wird mit Unsicherheit breiter', () {
      final sure = coneWidth(distance: 100, accuracy: 5, compassSpread: 5);
      final unsure = coneWidth(distance: 100, accuracy: 30, compassSpread: 20);
      expect(unsure, greaterThan(sure));
      expect(coneWidth(distance: 100, accuracy: 45, compassSpread: 0), 360);
    });

    test('Richtung als Uhrzeit', () {
      expect(clockDirection(0), 'auf 12 Uhr');
      expect(clockDirection(60), 'auf 2 Uhr');
      expect(clockDirection(-90), 'auf 9 Uhr');
    });
  });
}
