// Anstupsen: Über eine WebSocket-Verbindung meldet der Server, dass das Team gleich abgleichen soll,
// etwa bei einer Nachricht, einem Cue oder wenn die Spielleitung den SOS gelesen hat.
//
// Die Verbindung beschleunigt nur: Fällt sie aus, gleicht die App wie bisher im Takt ab. Abgerissene
// Verbindungen baut sie mit wachsender Pause neu auf, von 2 s bis 60 s.

import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;

/// Baut die WebSocket-Verbindung auf; in Tests ersetzbar.
typedef SocketConnect = Future<WebSocket> Function(Uri uri);

/// Ein Client für alle Versuche; nach dem Upgrade gehört die Verbindung dem WebSocket.
final _client = HttpClient()..connectionTimeout = const Duration(seconds: 15);

Future<WebSocket> _connect(Uri uri) => WebSocket.connect(uri.toString(), customClient: _client);

/// Adresse der Team-Verbindung, z. B. https://host/lykora → wss://host/lykora/api/play/live?access_token=…
Uri liveUri(String server, String token) {
  final base = Uri.parse(server.endsWith('/') ? server.substring(0, server.length - 1) : server);
  return base.replace(scheme: base.scheme == 'https' ? 'wss' : 'ws', path: '${base.path}/api/play/live', queryParameters: {'access_token': token});
}

/// Pause vor dem Neuversuch nach [failures] Fehlschlägen: 2, 4, 8, 16, 32, dann 60 Sekunden.
Duration liveBackoff(int failures) => Duration(seconds: math.min(60, 2 << math.min(math.max(failures, 1) - 1, 5)));

/// Hält die Team-Verbindung offen und meldet, wenn der Server anstupst.
class LiveLink {
  LiveLink({
    required this.uri,
    required this.onPoke,
    SocketConnect? connect,
    this.debounce = const Duration(milliseconds: 300),
    this.silence = const Duration(seconds: 70),
    this.backoff = liveBackoff,
  }) : _open = connect ?? _connect;

  final Uri uri;

  /// Jetzt abgleichen: Der Server hat angestupst, oder die Verbindung steht wieder und es kann etwas fehlen.
  final void Function() onPoke;
  final SocketConnect _open;

  /// Mehrere Stupser in dieser Zeit lösen nur einen Abgleich aus.
  final Duration debounce;

  /// Ohne Lebenszeichen so lange gilt die Verbindung als abgerissen; der Server pingt alle 25 s.
  final Duration silence;

  /// Pause vor dem nächsten Versuch nach so vielen Fehlschlägen
  final Duration Function(int failures) backoff;

  WebSocket? _socket;
  StreamSubscription<dynamic>? _sub;
  Timer? _retry;
  Timer? _poke;
  Timer? _watchdog;
  int _failures = 0;
  bool _running = false;
  bool _connecting = false;

  bool get connected => _socket != null;

  /// Alle laufenden Verbindungen, damit die App sie beim Zurückkehren in den Vordergrund wecken kann.
  static final _links = <LiveLink>{};

  /// Die App ist wieder im Vordergrund. Eine Verbindung, die im Hintergrund abgerissen ist, baut sofort neu auf,
  /// statt ihre Pause abzuwarten; nach dem Verbinden holt „hello“ nach, was inzwischen kam. Eine stehende bleibt:
  /// Den Abgleich beim Zurückkehren löst die Steuerung selbst aus.
  static void appResumed() {
    for (final link in _links.toList()) {
      link.wake();
    }
  }

  /// Fehlschläge seit der letzten guten Verbindung
  int get failures => _failures;

  void start() {
    if (_running) return;
    _running = true;
    _links.add(this);
    // Läuft vom letzten Start noch ein Versuch, übernimmt er; ein zweiter hielte zwei Verbindungen offen.
    if (!_connecting) _connectNow();
  }

  /// Netz ist wieder da: Wartet die Verbindung auf einen Neuversuch, gleich verbinden.
  /// Die Pause danach wächst weiter, falls es wieder nicht klappt.
  void wake() {
    if (!_running || _socket != null || _connecting) return;
    _retry?.cancel();
    _connectNow();
  }

  Future<void> stop() async {
    _running = false;
    _links.remove(this);
    _retry?.cancel();
    _poke?.cancel();
    _poke = null;
    _watchdog?.cancel();
    final socket = _socket;
    _socket = null;
    await _sub?.cancel();
    _sub = null;
    try {
      await socket?.close(WebSocketStatus.normalClosure);
    } catch (_) {}
  }

  Future<void> _connectNow() async {
    _connecting = true;
    try {
      final socket = await _open(uri);
      if (!_running) {
        await socket.close(WebSocketStatus.normalClosure);
        return;
      }
      _socket = socket;
      _alive();
      _sub = socket.listen(_onData, onDone: _lost, onError: (Object _) => _lost(), cancelOnError: true);
    } catch (_) {
      _schedule();
    } finally {
      _connecting = false;
    }
  }

  void _onData(dynamic data) {
    _alive();
    Object? msg;
    try {
      msg = jsonDecode(data as String);
    } catch (_) {
      return;
    }
    if (msg is! Map) return;
    switch (msg['type']) {
      case 'hello':
        _failures = 0;
        // Was während der Funkstille kam, gleich holen.
        _schedulePoke();
      case 'poke':
        _schedulePoke();
    }
  }

  void _schedulePoke() {
    _poke ??= Timer(debounce, () {
      _poke = null;
      if (_running) onPoke();
    });
  }

  /// Lebenszeichen: Wächter neu stellen.
  void _alive() {
    _watchdog?.cancel();
    _watchdog = Timer(silence, _lost);
  }

  void _lost() {
    final socket = _socket;
    if (socket == null) return;
    _socket = null;
    _watchdog?.cancel();
    _sub?.cancel();
    _sub = null;
    // Falscher Token: Neuversuche selten, bis die App neu beitritt.
    if (socket.closeCode == 4401) _failures = 5;
    unawaited(socket.close().catchError((_) {}));
    _schedule();
  }

  void _schedule() {
    if (!_running) return;
    _failures++;
    _retry?.cancel();
    _retry = Timer(backoff(_failures), () {
      if (_running && _socket == null && !_connecting) _connectNow();
    });
  }
}
