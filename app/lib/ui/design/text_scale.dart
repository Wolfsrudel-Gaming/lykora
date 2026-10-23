// Schriftgröße: die Einstellung des Systems mal der eigene Regler der App.
//
// Wer Android auf „Sehr groß“ gestellt hat, bekommt auch in der App große Schrift. Der Regler in den
// Einstellungen kommt obendrauf. Insgesamt gilt eine Obergrenze, bis zu der alle Bildschirme getestet sind.

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';

/// Größte Schrift insgesamt (System mal Regler): 200 %.
const maxTextScale = 2.0;

/// Kleinste Schrift insgesamt: 90 %.
const minTextScale = 0.9;

/// Skaliert mit dem Maßstab des Systems (auch nichtlinear, ab Android 14) und dem Regler der App.
@immutable
class LykoraTextScaler extends TextScaler {
  const LykoraTextScaler({required this.system, this.factor = 1.0});

  /// Maßstab, den das Gerät vorgibt
  final TextScaler system;

  /// Regler der App
  final double factor;

  @override
  double scale(double fontSize) => clampDouble(system.scale(fontSize) * factor, fontSize * minTextScale, fontSize * maxTextScale);

  @override
  // ignore: deprecated_member_use
  double get textScaleFactor => scale(fontSizeProbe) / fontSizeProbe;

  /// Bezugsgröße, um aus dem Maßstab eine einzelne Zahl zu schätzen
  static const fontSizeProbe = 14.0;

  @override
  bool operator ==(Object other) => other is LykoraTextScaler && other.system == system && other.factor == factor;

  @override
  int get hashCode => Object.hash(system, factor);
}

/// Gesamtfaktor für eine mittlere Schriftgröße, z. B. für die Anzeige „Schrift 150 %“.
double effectiveTextScale(TextScaler scaler) => scaler.scale(LykoraTextScaler.fontSizeProbe) / LykoraTextScaler.fontSizeProbe;

/// Wie stark Text im [context] gerade vergrößert wird (1,0 = unverändert). Für Maße, die mit der Schrift wachsen müssen.
double textGrowth(BuildContext context) => effectiveTextScale(MediaQuery.textScalerOf(context));
