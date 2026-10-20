import 'dart:async';

import 'package:geolocator/geolocator.dart';

/// Liefert GPS-Positionen, auch bei ausgeschaltetem Bildschirm.
///
/// Android beendet Apps im Hintergrund gern. Ein Vordergrunddienst mit Benachrichtigung
/// hält die Ortung am Leben; dazu muss das Team die Akku-Optimierung für Lykora abschalten.
class LocationService {
  LocationService._();

  /// Eine Ortung für die ganze App, damit Bildschirmwechsel sie nicht unterbrechen.
  static final instance = LocationService._();

  StreamSubscription<Position>? _sub;
  bool get running => _sub != null;

  Future<String?> ensurePermission() async {
    try {
      if (!await Geolocator.isLocationServiceEnabled()) return 'Standort ist ausgeschaltet. Bitte in den Einstellungen einschalten.';
      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) permission = await Geolocator.requestPermission();
      if (permission == LocationPermission.denied || permission == LocationPermission.deniedForever) {
        return 'Lykora braucht den Standort, um Stationen auszulösen und euch im Notfall zu finden.';
      }
      return null;
    } catch (_) {
      return 'Ortung ist auf diesem Gerät nicht verfügbar.';
    }
  }

  Future<void> start(void Function(Position p) onPosition) async {
    if (running) return;
    final settings = AndroidSettings(
      accuracy: LocationAccuracy.best,
      distanceFilter: 3,
      intervalDuration: const Duration(seconds: 5),
      foregroundNotificationConfig: const ForegroundNotificationConfig(
        notificationTitle: 'Lykora läuft',
        notificationText: 'Ortung für Stationen und Sicherheit ist aktiv.',
        enableWakeLock: true,
        setOngoing: true,
      ),
    );
    _sub = Geolocator.getPositionStream(locationSettings: settings).listen(onPosition, onError: (_) {});
  }

  Future<void> stop() async {
    await _sub?.cancel();
    _sub = null;
  }

  Future<void> openSettings() => Geolocator.openAppSettings();
}
