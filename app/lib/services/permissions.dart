import 'package:permission_handler/permission_handler.dart';

/// Stand einer Android-Berechtigung.
enum PermStatus {
  granted,

  /// Fehlt; die App darf fragen
  denied,

  /// Abgelehnt und Android fragt nicht mehr; nur die App-Einstellungen helfen
  blocked,

  /// Nicht zu ermitteln, z. B. auf einem Gerät ohne diese Funktion
  unknown,
}

/// Berechtigungen außer dem Standort (siehe LocationService): Benachrichtigung, Akku-Optimierung, Kamera.
///
/// Gefragt wird nur auf Wunsch ([ask]), nie beim bloßen Prüfen, damit die App vorher erklären kann, wofür sie sie braucht.
class DevicePermissions {
  DevicePermissions();

  /// Eine Quelle für die ganze App. Tests setzen einen Ersatz ein.
  static DevicePermissions instance = DevicePermissions();

  /// Android 13 und neuer: ohne sie fehlt der Hinweis „Lykora läuft“ und der Vordergrunddienst ist unsichtbar.
  Future<PermStatus> notifications({bool ask = false}) => _status(Permission.notification, ask);

  /// Ausnahme von der Akku-Optimierung, damit Android die Ortung bei ausgeschaltetem Bildschirm nicht beendet.
  Future<PermStatus> battery({bool ask = false}) => _status(Permission.ignoreBatteryOptimizations, ask);

  /// Zum Scannen der QR-Codes
  Future<PermStatus> camera({bool ask = false}) => _status(Permission.camera, ask);

  Future<void> openSettings() async {
    try {
      await openAppSettings();
    } catch (_) {}
  }

  Future<PermStatus> _status(Permission permission, bool ask) async {
    try {
      var s = await permission.status;
      if (ask && !s.isGranted && !s.isPermanentlyDenied) s = await permission.request();
      if (s.isGranted) return PermStatus.granted;
      if (s.isPermanentlyDenied) return PermStatus.blocked;
      return PermStatus.denied;
    } catch (_) {
      return PermStatus.unknown;
    }
  }
}
