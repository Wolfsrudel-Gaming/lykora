// Blickrichtung aus Magnetometer und Beschleunigungssensor, mit Neigungsausgleich.
//
// Liefert neben der Richtung eine Unsicherheit in Grad aus der Streuung der letzten Messungen.
// Der Peiler macht seinen Lichtkegel umso breiter, je unsicherer Kompass und GPS sind.

import 'dart:async';
import 'dart:io';
import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:sensors_plus/sensors_plus.dart';

class Compass extends ChangeNotifier {
  Compass._();
  static final instance = Compass._();

  /// In Widget-Tests aus, weil dort keine Sensoren laufen.
  static bool enabled = !Platform.environment.containsKey('FLUTTER_TEST');

  /// Grad im Uhrzeigersinn ab Norden; null ohne Sensor
  double? heading;

  /// Streuung der letzten Messungen in Grad
  double spread = 180;

  StreamSubscription<AccelerometerEvent>? _acc;
  StreamSubscription<MagnetometerEvent>? _mag;
  List<double>? _g;
  final _recent = <double>[];
  int _users = 0;
  DateTime _lastNotify = DateTime.fromMillisecondsSinceEpoch(0);

  /// Sensoren nur einschalten, solange jemand hinschaut; spart Akku.
  void acquire() {
    if (!enabled || _users++ > 0) return;
    try {
      _acc = accelerometerEventStream(samplingPeriod: SensorInterval.uiInterval).listen((e) {
        final g = _g;
        _g = g == null ? [e.x, e.y, e.z] : [g[0] * 0.8 + e.x * 0.2, g[1] * 0.8 + e.y * 0.2, g[2] * 0.8 + e.z * 0.2];
      }, onError: (_) {});
      _mag = magnetometerEventStream(samplingPeriod: SensorInterval.uiInterval).listen(_onMag, onError: (_) {});
    } catch (_) {}
  }

  void release() {
    if (!enabled || --_users > 0) return;
    _users = 0;
    _acc?.cancel();
    _mag?.cancel();
    _acc = null;
    _mag = null;
    heading = null;
    _recent.clear();
  }

  void _onMag(MagnetometerEvent m) {
    final g = _g;
    if (g == null) return;
    final h = headingFrom(g, [m.x, m.y, m.z]);
    if (h == null) return;
    _recent.add(h);
    if (_recent.length > 12) _recent.removeAt(0);
    final mean = circularMean(_recent);
    heading = mean;
    spread = math.max(8, _recent.map((x) => angleDiff(x, mean).abs()).reduce(math.max));
    // Höchstens 10-mal pro Sekunde neu zeichnen.
    final now = DateTime.now();
    if (now.difference(_lastNotify).inMilliseconds >= 100) {
      _lastNotify = now;
      notifyListeners();
    }
  }
}

/// Richtung der Oberkante des Handys in Grad ab magnetisch Nord, aus Schwerkraft und Magnetfeld.
double? headingFrom(List<double> g, List<double> m) {
  // Osten = m × g, Norden = g × Osten (Android SensorManager.getRotationMatrix)
  var ex = m[1] * g[2] - m[2] * g[1], ey = m[2] * g[0] - m[0] * g[2], ez = m[0] * g[1] - m[1] * g[0];
  final en = math.sqrt(ex * ex + ey * ey + ez * ez);
  final gn = math.sqrt(g[0] * g[0] + g[1] * g[1] + g[2] * g[2]);
  if (en < 0.1 || gn < 0.1) return null;
  ex /= en;
  ey /= en;
  ez /= en;
  final ax = g[0] / gn, az = g[2] / gn;
  final ny = az * ex - ax * ez;
  final h = math.atan2(ey, ny) * 180 / math.pi;
  return (h + 360) % 360;
}

double circularMean(List<double> deg) {
  var s = 0.0, c = 0.0;
  for (final d in deg) {
    s += math.sin(d * math.pi / 180);
    c += math.cos(d * math.pi / 180);
  }
  return (math.atan2(s, c) * 180 / math.pi + 360) % 360;
}

/// Kleinster Winkel von a nach b, −180 bis 180.
double angleDiff(double a, double b) => ((b - a + 540) % 360) - 180;
