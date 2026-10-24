import 'dart:async';

import 'package:geolocator/geolocator.dart';

/// Ob die Ortung benutzbar ist, und wenn nicht, woran es liegt.
enum LocationState {
  /// Standort an, Erlaubnis da
  ready,

  /// Standort ist in den Einstellungen des Handys ausgeschaltet
  serviceOff,

  /// Erlaubnis fehlt noch; die App darf sie erfragen
  denied,

  /// Erlaubnis abgelehnt und Android fragt nicht mehr; nur noch die App-Einstellungen helfen
  deniedForever,

  /// Das Handy kann (oder will) keine Ortung liefern
  unavailable,
}

/// Liefert GPS-Positionen, auch bei ausgeschaltetem Bildschirm.
///
/// Android beendet Apps im Hintergrund gern. Ein Vordergrunddienst mit Benachrichtigung
/// hält die Ortung am Leben; dazu muss das Team die Akku-Optimierung für Lykora abschalten.
/// „Beim Verwenden der App“ reicht dafür: Der Dienst startet im Vordergrund und behält die Erlaubnis.
class LocationService {
  LocationService();

  /// Eine Ortung für die ganze App, damit Bildschirmwechsel sie nicht unterbrechen. Tests setzen einen Ersatz ein.
  static LocationService instance = LocationService();

  StreamSubscription<Position>? _sub;
  bool get running => _sub != null;

  /// Prüft, ohne zu fragen.
  Future<LocationState> check() async {
    try {
      if (!await Geolocator.isLocationServiceEnabled()) return LocationState.serviceOff;
      return _map(await Geolocator.checkPermission());
    } catch (_) {
      return LocationState.unavailable;
    }
  }

  /// Fragt nach der Erlaubnis, wenn sie fehlt und Android noch fragt.
  Future<LocationState> request() async {
    try {
      if (!await Geolocator.isLocationServiceEnabled()) return LocationState.serviceOff;
      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) permission = await Geolocator.requestPermission();
      return _map(permission);
    } catch (_) {
      return LocationState.unavailable;
    }
  }

  LocationState _map(LocationPermission p) => switch (p) {
    LocationPermission.denied => LocationState.denied,
    LocationPermission.deniedForever => LocationState.deniedForever,
    LocationPermission.unableToDetermine => LocationState.unavailable,
    _ => LocationState.ready,
  };

  /// Satz für das Team, warum die Ortung fehlt; null, wenn sie läuft.
  static String? problemText(LocationState state) => switch (state) {
    LocationState.ready => null,
    LocationState.serviceOff => 'Standort ist ausgeschaltet. Bitte in den Einstellungen einschalten.',
    LocationState.denied => 'Lykora braucht den Standort, um Stationen auszulösen und euch im Notfall zu finden.',
    LocationState.deniedForever => 'Der Standort ist für Lykora gesperrt. In den Einstellungen unter Berechtigungen erlauben.',
    LocationState.unavailable => 'Ortung ist auf diesem Gerät nicht verfügbar.',
  };

  /// Fragt nach der Erlaubnis und liefert einen Satz, falls die Ortung nicht läuft; null heißt: bereit.
  Future<String?> ensurePermission() async => problemText(await request());

  /// [onError] bekommt Fehler des Ortungsstroms (Ortung ausgeschaltet, Erlaubnis entzogen), damit sie nicht verschwinden.
  Future<void> start(void Function(Position p) onPosition, {void Function(Object error)? onError}) async {
    if (running) return;
    final settings = AndroidSettings(
      accuracy: LocationAccuracy.best,
      // Ohne Abstandsfilter kommt alle 5 s ein Fix, auch wenn das Team steht; so zeigt das Alter der Position, ob die Ortung lebt.
      distanceFilter: 0,
      intervalDuration: const Duration(seconds: 5),
      foregroundNotificationConfig: const ForegroundNotificationConfig(
        notificationTitle: 'Lykora läuft',
        notificationText: 'Ortung für Stationen und Sicherheit ist aktiv.',
        enableWakeLock: true,
        setOngoing: true,
      ),
    );
    _sub = Geolocator.getPositionStream(locationSettings: settings).listen(onPosition, onError: onError ?? (_) {});
  }

  /// Beendet den Strom und startet ihn neu, z. B. wenn die Erlaubnis zurückgekehrt ist und der alte Strom tot ist.
  Future<void> restart(void Function(Position p) onPosition, {void Function(Object error)? onError}) async {
    await stop();
    await start(onPosition, onError: onError);
  }

  Future<void> stop() async {
    await _sub?.cancel();
    _sub = null;
  }

  /// Einstellungen der App (Berechtigungen)
  Future<void> openSettings() async {
    try {
      await Geolocator.openAppSettings();
    } catch (_) {}
  }

  /// Einstellungen des Handys, in denen der Standort eingeschaltet wird
  Future<void> openLocationSettings() async {
    try {
      await Geolocator.openLocationSettings();
    } catch (_) {}
  }
}
