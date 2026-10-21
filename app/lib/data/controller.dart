import 'dart:async';
import 'dart:io';
import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:uuid/uuid.dart';

import '../engine/geo.dart';
import '../engine/team_state.dart';
import '../model/game.dart';
import 'api.dart';
import 'session.dart';
import '../services/live.dart';
import '../services/nfc.dart' show normalizeTagId;

const _uuid = Uuid();

/// Name im Medienordner für einen nachgeladenen Cue, z. B. media/lib/eule.ogg → cue-lib-eule.ogg.
/// Der ganze Pfad (bei URLs mit Host) geht ein, damit zwei Dateien gleichen Namens sich nicht überschreiben.
String cueFileName(String src) {
  final uri = Uri.tryParse(src);
  final parts = [
    if (uri != null && uri.host.isNotEmpty) uri.host,
    for (final p in uri?.pathSegments ?? [src])
      if (p.isNotEmpty && p != '.' && p != '..') p,
  ];
  if (parts.length > 1 && parts.first == 'media') parts.removeAt(0);
  final name = parts.join('-').replaceAll(RegExp(r'[^A-Za-z0-9._-]'), '_');
  // Dateinamen dürfen nicht beliebig lang werden; das Ende mit der Endung bleibt.
  return 'cue-${name.length > 120 ? name.substring(name.length - 120) : name}';
}

/// Warnung zu einer Sperrzone oder zur Spielfeldgrenze.
class ZoneAlert {
  ZoneAlert(this.message, {required this.inside, this.zone, this.distance = 0});
  final String message;
  final bool inside;

  /// Die Sperrzone; null heißt Spielfeldgrenze
  final RestrictedZone? zone;

  /// Abstand zur Zone in Metern, 0 wenn drin
  final double distance;

  bool get boundary => zone == null;
}

/// Ergebnis einer Aktion für die Oberfläche.
class ActionResult {
  ActionResult(this.outcome, this.state);
  final Outcome? outcome;
  final TeamState state;
  bool get ok => outcome?.ok ?? false;
}

/// Hält die Sitzung, rechnet den Spielstand lokal und gleicht mit dem Server ab.
///
/// Jede Handlung des Teams wird sofort lokal ausgewertet und gespeichert. Der Abgleich
/// läuft im Hintergrund, sobald Netz da ist; der Server entscheidet am Ende.
class GameController extends ChangeNotifier {
  GameController({
    required this.store,
    Api Function(String server, String? token)? apiFactory,
    int Function()? clock,
    this.backgroundLoops = true,
    this.connectLive,
  }) : _apiFactory = apiFactory ?? ((s, t) => Api(s, token: t)),
       _deviceClock = clock ?? (() => DateTime.now().millisecondsSinceEpoch);

  /// Abgleich, Sekundentakt und Anstupsen im Hintergrund; in Widget-Tests aus, weil dort die Zeit simuliert ist.
  final bool backgroundLoops;

  final SessionStore store;
  final Api Function(String server, String? token) _apiFactory;
  final int Function() _deviceClock;

  /// Baut die Verbindung zum Anstupsen auf; ohne Angabe ein echter WebSocket.
  final SocketConnect? connectLive;

  Session? session;
  Game? game;

  /// Kennung des geladenen Spiels; ändert sich nur bei einem anderen Spiel, nicht bei jedem Takt.
  final gameId = ValueNotifier<String?>(null);
  Api? _api;
  TeamState _state = TeamState();
  Timer? _syncTimer;
  Timer? _tick;
  LiveLink? _live;
  bool syncing = false;

  /// Während eines Abgleichs angestupst: direkt danach noch einmal abgleichen.
  bool _syncAgain = false;
  bool online = false;
  String? lastError;
  int _failures = 0;
  Future<void> _saving = Future.value();

  GeoPoint? position;
  double? accuracy;
  DateTime? positionAt;
  GeoPoint? _lastRecorded;
  int _lastRecordedAt = 0;
  double? battery;
  ZoneAlert? zoneAlert;
  final Map<String, int> _triggerAttempts = {};

  /// Laufende Downloads für Cues, damit zwei gleiche Cues die Datei nicht doppelt laden
  final _fetching = <String, Future<bool>>{};

  /// Gelaufener Weg der letzten 30 Minuten für die Fußspur auf der Karte
  final List<(GeoPoint, int)> trail = [];

  /// Ziel des Peilers; null heißt automatisch das nächste offene Ziel
  String? peilTarget;

  final _incoming = StreamController<ChatMessage>.broadcast();

  /// Neue Nachrichten der Zentrale: Die Oberfläche vibriert und liest vor, die Klanglandschaft spielt Cues.
  Stream<ChatMessage> get incoming => _incoming.stream;

  /// Wird bei Rückruf oder Warnung zu Sperrzonen aufgerufen.
  void Function(String kind)? onAlert;

  TeamState get state => _state;
  bool get hasSession => session != null;
  bool get hasGame => game != null;

  /// Uhrzeit, korrigiert um die Abweichung zur Server-Uhr.
  int now() => _deviceClock() + (session?.clockOffsetMs ?? 0);

  // ---------------------------------------------------------------------------
  // Start und Beitritt

  Future<void> load() async {
    final s = await store.load();
    if (s == null) return;
    _attach(s);
    _recompute();
    notifyListeners();
  }

  void _attach(Session s) {
    session = s;
    game = s.gameJson == null ? null : Game(s.gameJson!);
    gameId.value = game?.id;
    _api = _apiFactory(s.server, s.token);
  }

  /// Startet den regelmäßigen Abgleich, die Zeitprüfung und die Verbindung, über die der Server anstupst.
  void startLoops() {
    if (!backgroundLoops) return;
    _tick?.cancel();
    _tick = Timer.periodic(const Duration(seconds: 1), (_) => notifyListeners());
    _scheduleSync(const Duration(seconds: 1));
    final s = session;
    if (s != null && _live == null) {
      _live = LiveLink(uri: liveUri(s.server, s.token), onPoke: _onPoke, connect: connectLive)..start();
    }
  }

  void stopLoops() {
    _tick?.cancel();
    _syncTimer?.cancel();
    _live?.stop();
    _live = null;
  }

  @override
  void dispose() {
    stopLoops();
    gameId.dispose();
    _incoming.close();
    super.dispose();
  }

  /// Neues Team anlegen oder mit [deviceCode] einem bestehenden Team beitreten.
  Future<void> join({
    required String server,
    required String code,
    String? deviceCode,
    String? teamName,
    String? color,
    List<String> members = const [],
    String? emergencyPhone,
    String? supervisorPin,
  }) async {
    final api = _apiFactory(server, null);
    final res = await api.join({
      'code': code,
      'deviceCode': ?deviceCode,
      'device': Platform.operatingSystem,
      if (deviceCode == null)
        'team': {
          'name': teamName,
          'color': ?color,
          'members': members,
          if (emergencyPhone != null && emergencyPhone.isNotEmpty) 'emergencyPhone': emergencyPhone,
          if (supervisorPin != null && supervisorPin.isNotEmpty) 'supervisorPin': supervisorPin,
        },
    });
    final s = Session(
      server: server,
      token: res['token'] as String,
      eventId: res['eventId'] as String,
      eventCode: code,
      team: (res['team'] as Map).cast<String, dynamic>(),
    );
    _attach(s);
    await downloadGame();
  }

  /// Lädt Spielpaket und Medien, damit das Spiel offline läuft.
  Future<void> downloadGame() async {
    final s = session!;
    final pkg = await _api!.game();
    s.gameJson = (pkg['game'] as Map).cast<String, dynamic>();
    s.event = (pkg['event'] as Map).cast<String, dynamic>();
    s.team = (pkg['team'] as Map).cast<String, dynamic>();
    s.supervisorRequired = pkg['supervisorRequired'] as bool? ?? false;
    _updateClock(pkg['serverTime'] as String?);
    game = Game(s.gameJson!);
    gameId.value = game!.id;
    await _downloadMedia();
    _recompute();
    await _save();
    notifyListeners();
  }

  Future<void> _downloadMedia() async {
    final media = game!.mediaList;
    if (media.isEmpty) return;
    final dir = store.mediaDir;
    await dir.create(recursive: true);
    for (final m in media) {
      final file = File('${dir.path}/${m.id}');
      // Fehlende Medien verhindern das Spiel nicht.
      if (!await file.exists()) await _api!.download(m.src, file);
    }
  }

  /// Datei einer Medien-ID aus dem Spielpaket, falls sie auf dem Gerät liegt.
  File? mediaFile(String? id) {
    if (id == null) return null;
    final f = File('${store.mediaDir.path}/$id');
    return f.existsSync() ? f : null;
  }

  /// Datei zu einem Cue: aus dem Spielpaket oder einmal nachgeladen in den Medienordner.
  Future<File?> cueFile(Cue cue) async {
    final media = game?.media(cue.audio);
    final inGame = media != null;
    final own = inGame ? mediaFile(cue.audio) : null;
    if (own != null) return own;
    final src = cue.src ?? media?.src;
    final api = _api;
    if (src == null || api == null) return null;
    final dir = store.mediaDir;
    await dir.create(recursive: true);
    // Fehlte die Datei schon beim Packen, liegt sie danach unter ihrer ID aus dem Spiel.
    final file = File('${dir.path}/${inGame ? cue.audio : cueFileName(src)}');
    if (await file.exists()) return file;
    final ok = await (_fetching[file.path] ??= api.download(src, file).whenComplete(() {
      _fetching.remove(file.path);
    }));
    return ok ? file : null;
  }

  /// Team verlassen und alle lokalen Daten löschen.
  Future<void> leave() async {
    stopLoops();
    session = null;
    game = null;
    gameId.value = null;
    _state = TeamState();
    trail.clear();
    peilTarget = null;
    // Ein Abgleich, der gerade speichert, darf die gelöschten Daten nicht wieder anlegen.
    await _saving;
    await store.clear();
    notifyListeners();
  }

  // ---------------------------------------------------------------------------
  // Spielstand

  int? get eventStartedAt {
    final started = session?.event['startedAt'] as String?;
    return started == null ? null : DateTime.parse(started).millisecondsSinceEpoch;
  }

  bool get eventRunning => session?.eventStatus == 'running';

  bool get eventEnded => session?.eventStatus == 'ended';
  bool get recalled => session?.eventStatus == 'recalled';
  bool get paused => session?.eventStatus == 'paused';
  bool get supervisorMissing => (session?.supervisorRequired ?? false) && !(session?.supervisorPresent ?? false);

  TeamContext _context() {
    final s = session!;
    return TeamContext(
      game: game!,
      eventStartedAt: eventStartedAt,
      endedAt: s.event['endedAt'] == null ? null : DateTime.parse(s.event['endedAt'] as String).millisecondsSinceEpoch,
      pauses: [
        for (final p in (s.event['pauses'] as List? ?? const []).cast<Map>())
          Pause(DateTime.parse(p['from'] as String).millisecondsSinceEpoch, p['to'] == null ? null : DateTime.parse(p['to'] as String).millisecondsSinceEpoch),
      ],
      blockReason: supervisorMissing ? 'supervisor_required' : null,
    );
  }

  void _recompute() {
    if (session == null || game == null) return;
    final actions = [
      for (final a in session!.actions)
        EngineAction(clientId: a.id, type: a.type, payload: a.payload, time: a.time, source: a.source, seq: a.seq ?? (1 << 40) + session!.actions.indexOf(a)),
    ];
    _state = reduceTeam(_context(), actions);
  }

  bool get started => _state.startedAt != null;
  bool get finished => _state.finishedAt != null;

  /// Restzeit in Sekunden inklusive Strafen; null ohne Zeitlimit.
  double? get remaining => game == null ? null : remainingAt(_context(), _state, now());

  /// Stationen, die das Team gerade sehen darf.
  List<Station> get visibleStations {
    if (game == null) return const [];
    return game!.stations.where((s) {
      if (_state.locked.contains(s.id)) return false;
      if (!s.hidden || _state.revealed.contains(s.id)) return true;
      // Versteckte Station mit Annäherungs-Radius erscheint, sobald das Team nah genug ist.
      final r = s.revealRadius;
      return r != null && position != null && s.location != null && distance(position!, s.location!) <= r;
    }).toList();
  }

  bool fragmentsComplete() => game!.fragments.every((f) => _state.fragments.contains(f.id));

  // ---------------------------------------------------------------------------
  // Aktionen

  Future<ActionResult> record(String type, Json payload) async {
    final s = session!;
    final p = {...payload};
    if (position != null && !p.containsKey('location')) {
      p['location'] = {...position!.toJson(), if (accuracy != null) 'accuracy': accuracy};
    }
    final action = LocalAction(id: _uuid.v4(), type: type, payload: p, time: now());
    s.actions.add(action);
    _recompute();
    await _save();
    notifyListeners();
    _scheduleSync(const Duration(milliseconds: 300));
    return ActionResult(_state.outcome(action.id), _state);
  }

  Future<ActionResult> start() => record('start', {});

  Future<ActionResult> trigger(String stationId, String method, {Json extra = const {}}) =>
      record('trigger', {'station': stationId, 'method': method, ...extra});

  Future<ActionResult> answer(String stationId, Json answer) => record('answer', {'station': stationId, ...answer});

  Future<ActionResult> hint(String stationId) => record('hint', {'station': stationId, 'level': (_state.hints[stationId] ?? 0) + 1});

  Future<ActionResult> heartbeat() async {
    session!.lastHeartbeatAt = now();
    return record('heartbeat', {});
  }

  Future<ActionResult> arrived() => record('arrived', {});

  /// Prüft einen QR-Code oder NFC-Tag gegen alle Stationen und löst die passende aus.
  Future<ActionResult?> triggerByCode(String type, String value) async {
    for (final s in game!.stations) {
      for (final t in s.triggers) {
        final match =
            (type == 'qr' && t.type == 'qr' && t.code == value) ||
            (type == 'nfc' && t.type == 'nfc' && normalizeTagId(t.tag ?? '') == normalizeTagId(value) && value.isNotEmpty) ||
            (type == 'manual' && t.type == 'manual' && t.code == value);
        if (match) return trigger(s.id, type);
      }
    }
    return null;
  }

  /// Betreuer mit der Betreuer-PIN bestätigen. Braucht Netz, weil nur der Server die PIN kennt.
  Future<void> confirmSupervisor(String pin) async {
    final res = await _api!.confirmSupervisor(pin);
    session!.team = res;
    _recompute();
    await _save();
    notifyListeners();
  }

  // ---------------------------------------------------------------------------
  // Erzählung

  /// Szene einer Station als erlebt merken, damit sie beim nächsten Öffnen nicht von vorn beginnt.
  Future<void> markSceneSeen(String stationId) async {
    if (session!.seenScenes.add(stationId)) await _save();
  }

  Future<void> markIntroSeen() async {
    session!.introSeen = true;
    await _save();
    notifyListeners();
  }

  /// Aktuelles Kapitel: zuletzt freigeschaltet, sonst das erste.
  Chapter? get currentChapter {
    final g = game;
    if (g == null || g.chapters.isEmpty) return null;
    for (final id in _state.chapters.reversed) {
      final c = g.chapter(id);
      if (c != null) return c;
    }
    return g.chapters.first;
  }

  int get chapterNumber {
    final c = currentChapter;
    return c == null ? 0 : game!.chapters.indexOf(c) + 1;
  }

  /// Fragment-Werte nach Position, null für noch fehlend.
  List<String?> get keyRing => [for (final f in game?.fragments ?? const <Fragment>[]) _state.fragments.contains(f.id) ? f.value : null];

  /// Station, von der ein Fragment kommt.
  Station? fragmentSource(String fragmentId) {
    for (final s in game!.stations) {
      if ((s.rewards['fragments'] as List? ?? const []).contains(fragmentId)) return s;
    }
    return null;
  }

  /// Station, die das Team als Nächstes ansteuern sollte.
  Station? get nextTarget {
    final g = game;
    if (g == null) return null;
    final chosen = peilTarget == null ? null : g.station(peilTarget!);
    if (chosen != null && visibleStations.contains(chosen) && !_state.solved.containsKey(chosen.id)) return chosen;
    final open = visibleStations.where((s) => !_state.solved.containsKey(s.id) && (!s.isFinal || fragmentsComplete())).toList();
    if (open.isEmpty) return null;
    // Schon ausgelöst und ungelöst geht vor: dort wartet das Rätsel.
    final waiting = open.where((s) => _state.triggered.contains(s.id)).toList();
    if (waiting.isNotEmpty) return waiting.first;
    final pos = position;
    if (pos == null) return open.first;
    open.sort(
      (a, b) =>
          (a.location == null ? double.infinity : distance(pos, a.location!)).compareTo(b.location == null ? double.infinity : distance(pos, b.location!)),
    );
    return open.first;
  }

  void choosePeilTarget(String? id) {
    peilTarget = id;
    notifyListeners();
  }

  /// Funkspruch der Zentrale nur auf diesem Handy, z. B. die Beruhigung bei „Uns ist mulmig“.
  Future<void> addLocalRadio(String text, {String kind = 'story'}) async {
    session!.messages.add(ChatMessage(direction: 'to_team', kind: kind, sender: 'hq', body: text, at: DateTime.now()));
    await _save();
    notifyListeners();
  }

  // ---------------------------------------------------------------------------
  // Sicherheit

  /// Rückruf quittieren: Die Spielleitung erfährt, dass das Team unterwegs ist.
  Future<void> acknowledgeRecall() async {
    session!.recallAcknowledged = true;
    await _save();
    notifyListeners();
    await sendMessage('Wir sind unterwegs zum Sammelpunkt.', kind: 'predefined');
  }

  /// Nachrichten der Spielleitung außerhalb der Geschichte, die noch niemand gelesen hat.
  List<ChatMessage> get unreadSystem => [
    for (final m in session?.messages ?? const <ChatMessage>[])
      if (m.incoming && m.kind == 'system' && (m.id ?? 0) > (session!.systemAck)) m,
  ];

  Future<void> acknowledgeSystem() async {
    final ids = unreadSystem.map((m) => m.id ?? 0);
    if (ids.isEmpty) return;
    session!.systemAck = ids.reduce(math.max);
    await _save();
    notifyListeners();
  }

  // ---------------------------------------------------------------------------
  // Lebenszeichen

  bool get heartbeatDue {
    final g = game;
    if (g == null || !g.safety.heartbeatEnabled || !started || finished || eventEnded) return false;
    final last = session!.lastHeartbeatAt ?? _state.startedAt!;
    return now() - last > g.safety.heartbeatInterval * 1000;
  }

  // ---------------------------------------------------------------------------
  // Position

  /// Neue GPS-Position vom Ortungsdienst.
  Future<void> onPosition(double lat, double lon, double acc, {DateTime? at}) async {
    final s = session;
    if (s == null || game == null) return;
    position = GeoPoint(lat, lon);
    accuracy = acc;
    positionAt = at ?? DateTime.now();
    final t = now();

    // Laufspur sparsam aufzeichnen: alle 30 s oder nach 15 m.
    final moved = _lastRecorded == null ? double.infinity : distance(_lastRecorded!, position!);
    if (moved >= 15 || t - _lastRecordedAt >= 30000) {
      s.pendingPositions.add({'lat': lat, 'lon': lon, 'accuracy': acc, 'time': DateTime.fromMillisecondsSinceEpoch(t).toUtc().toIso8601String()});
      if (s.pendingPositions.length > 5000) s.pendingPositions.removeRange(0, s.pendingPositions.length - 5000);
      _lastRecorded = position;
      _lastRecordedAt = t;
    }

    if (trail.isEmpty || distance(trail.last.$1, position!) >= 5) trail.add((position!, t));
    while (trail.isNotEmpty && t - trail.first.$2 > 30 * 60000) {
      trail.removeAt(0);
    }

    _checkZones();
    if (eventRunning && started && !finished) await _autoTrigger(t);
    notifyListeners();
  }

  Future<void> _autoTrigger(int t) async {
    for (final s in game!.stations) {
      final gps = s.trigger('gps');
      final target = gps?.location ?? s.location;
      if (gps == null || target == null || _state.triggered.contains(s.id)) continue;
      // Der Radius wächst, wenn das GPS ungenau ist, damit ein schlechter Fix das Spiel nicht stoppt.
      final radius = gps.radius + math.min(accuracy ?? 0, 30);
      if (distance(position!, target) > radius) continue;
      if (t - (_triggerAttempts[s.id] ?? 0) < 60000) continue;
      _triggerAttempts[s.id] = t;
      await trigger(s.id, 'gps');
    }
  }

  void _checkZones() {
    final g = game!;
    ZoneAlert? alert;
    for (final z in g.field.restrictedZones) {
      final d = distanceToArea(position!, z.area);
      final name = z.name.resolve(g.language);
      if (d == 0) {
        alert = ZoneAlert('Ihr seid in der Sperrzone „$name“. Geht sofort zurück.', inside: true, zone: z);
        break;
      }
      if (d <= z.warnDistance && (alert == null || d < alert.distance)) {
        alert = ZoneAlert('Achtung: $name in ${d.round()} m. Umkehren.', inside: false, zone: z, distance: d);
      }
    }
    final out = distanceToArea(position!, g.field.boundary);
    if (alert == null && out > 0) {
      alert = ZoneAlert('Ihr verlasst das Spielfeld. Umkehren.', inside: false, distance: out);
    }
    final changed = alert?.inside != zoneAlert?.inside || alert?.zone?.id != zoneAlert?.zone?.id || (alert == null) != (zoneAlert == null);
    zoneAlert = alert;
    if (changed && alert != null) onAlert?.call(alert.inside ? 'zone_inside' : 'zone_near');
  }

  // ---------------------------------------------------------------------------
  // Nachrichten

  Future<void> sendMessage(String body, {String kind = 'chat'}) async {
    final s = session!;
    final msg = ChatMessage(direction: 'from_team', kind: kind, body: body, at: DateTime.now(), clientId: _uuid.v4(), pending: true);
    s.messages.add(msg);
    await _save();
    notifyListeners();
    await _flushMessages();
  }

  Future<void> _flushMessages() async {
    for (final m in session!.messages.where((m) => m.pending).toList()) {
      try {
        await _api!.message({'id': m.clientId, 'body': m.body, 'kind': m.kind});
        m.pending = false;
      } on ApiException catch (e) {
        if (e.offline) return;
        m.pending = false;
      }
    }
    await _save();
    notifyListeners();
  }

  // ---------------------------------------------------------------------------
  // SOS

  /// Löst SOS aus. Gibt true zurück, wenn der Server den Alarm bestätigt hat.
  /// Ohne Netz wird der Alarm gespeichert und beim nächsten Netzkontakt nachgeholt.
  Future<bool> sos({String? message}) async {
    final s = session!;
    final record = {
      'id': _uuid.v4(),
      'time': DateTime.fromMillisecondsSinceEpoch(now()).toUtc().toIso8601String(),
      if (position != null) 'lat': position!.lat,
      if (position != null) 'lon': position!.lon,
      if (accuracy != null) 'accuracy': accuracy,
      if (message != null && message.isNotEmpty) 'message': message,
    };
    // Damit die SOS-Seite zeigen kann, ob die Spielleitung den Alarm gelesen hat; gespeichert wird mit dem nächsten Abgleich.
    s.lastSosId = record['id'] as String;
    try {
      await _api!.sos(record);
      return true;
    } on ApiException catch (e) {
      if (!e.offline) return false;
      s.pendingSos.add({...record, 'deferred': true});
      await _save();
      notifyListeners();
      _scheduleSync(const Duration(seconds: 5));
      return false;
    }
  }

  bool get sosPending => session?.pendingSos.isNotEmpty ?? false;

  /// Stand eines SOS laut letztem Abgleich (acknowledgedAt, resolvedAt, acknowledgedBy); null, solange der Server nichts meldet.
  Json? sosStatus(String? clientId) {
    if (clientId == null) return null;
    for (final x in session?.sos ?? const <Json>[]) {
      if (x['clientId'] == clientId) return x;
    }
    return null;
  }

  /// Text für die SOS-SMS, siehe server/src/routes/integrations.ts.
  String sosSmsText({String? message}) {
    final s = session!;
    final pos = position == null ? '' : ' ${position!.lat.toStringAsFixed(5)},${position!.lon.toStringAsFixed(5)}';
    return 'LYKORA SOS ${s.eventCode} ${s.deviceCode}$pos ${message ?? 'Hilfe benötigt'} (${s.teamName})';
  }

  // ---------------------------------------------------------------------------
  // Fotos

  /// Speichert ein Foto lokal und reicht es nach, sobald Netz da ist.
  Future<String> addUpload(Uint8List bytes, String contentType) async {
    final id = _uuid.v4();
    final dir = store.uploadsDir;
    await dir.create(recursive: true);
    await File('${dir.path}/$id').writeAsBytes(bytes, flush: true);
    session!.pendingUploads.add({'id': id, 'contentType': contentType});
    await _save();
    _scheduleSync(const Duration(seconds: 1));
    return id;
  }

  Future<void> _flushUploads() async {
    final s = session!;
    for (final u in s.pendingUploads.toList()) {
      final file = File('${store.uploadsDir.path}/${u['id']}');
      if (!await file.exists()) {
        s.pendingUploads.remove(u);
        continue;
      }
      try {
        await _api!.upload(u['id'] as String, u['contentType'] as String, await file.readAsBytes());
      } on ApiException catch (e) {
        if (e.offline) rethrow;
        // Datei passt nicht (Typ oder Größe): verwerfen statt ewig neu zu versuchen.
        lastError = 'Foto nicht angenommen: ${e.message}';
      }
      s.pendingUploads.remove(u);
      await file.delete();
    }
  }

  // ---------------------------------------------------------------------------
  // Abgleich

  void _scheduleSync(Duration delay) {
    if (!backgroundLoops) return;
    _syncTimer?.cancel();
    _syncTimer = Timer(delay, () => sync());
  }

  /// Der Server hat angestupst: gleich abgleichen, und läuft schon ein Abgleich, direkt danach noch einmal.
  void _onPoke() {
    if (syncing) {
      _syncAgain = true;
    } else {
      sync();
    }
  }

  /// Gleicht Aktionen, Positionen, SOS, Nachrichten und Fotos mit dem Server ab.
  Future<void> sync() async {
    final s = session;
    if (s == null || syncing) return;
    syncing = true;
    final wasOnline = online;
    notifyListeners();
    try {
      for (final sos in s.pendingSos.toList()) {
        try {
          await _api!.sos(sos);
          s.pendingSos.remove(sos);
        } on ApiException catch (e) {
          // Ohne Netz abbrechen; lehnt der Server ab, bleibt der Alarm sichtbar, blockiert aber den Abgleich nicht.
          if (e.offline) rethrow;
          lastError = 'SOS abgelehnt: ${e.message}';
        }
      }
      final unsynced = s.actions.where((a) => !a.synced && a.source == 'team').toList();
      final positions = [...s.pendingPositions];
      final res = await _api!.sync({
        'deviceTime': DateTime.fromMillisecondsSinceEpoch(now()).toUtc().toIso8601String(),
        'actions': [
          for (final a in unsynced)
            {'id': a.id, 'type': a.type, 'time': DateTime.fromMillisecondsSinceEpoch(a.time).toUtc().toIso8601String(), 'payload': a.payload},
        ],
        'positions': positions,
        if (battery != null) 'battery': battery,
        'messagesAfter': s.messageCursor,
        'actionsAfter': s.actionCursor,
      });
      _applySync(res, positions.length);
      await _flushMessages();
      await _flushUploads();
      online = true;
      lastError = null;
      _failures = 0;
      // Netz wieder da: Die Verbindung zum Anstupsen muss nicht erst ihre Pause abwarten.
      if (!wasOnline) _live?.wake();
    } on ApiException catch (e) {
      online = !e.offline;
      lastError = e.message;
      _failures++;
    } catch (e) {
      lastError = '$e';
      _failures++;
    } finally {
      syncing = false;
      await _save();
      notifyListeners();
      // Mit Netz alle 15 s, ohne Netz seltener, um Akku zu sparen.
      final delay = _failures == 0 ? 15 : math.min(15 * (1 << math.min(_failures, 3)), 120);
      final again = _syncAgain;
      _syncAgain = false;
      // Nach leave() oder stopLoops() nicht weiter abgleichen.
      if (_tick != null && _tick!.isActive) _scheduleSync(again ? Duration.zero : Duration(seconds: delay));
    }
  }

  void _applySync(Json res, int sentPositions) {
    final s = session!;
    _updateClock(res['serverTime'] as String?);
    final previousStatus = s.eventStatus;
    s.event = (res['event'] as Map).cast<String, dynamic>();
    if (res['team'] is Map) {
      final team = (res['team'] as Map).cast<String, dynamic>();
      // Lokal bestätigter Betreuer bleibt, bis der Server es auch weiß.
      if (s.supervisorPresent && team['supervisorPresent'] != true) team['supervisorPresent'] = true;
      s.team = team;
    }
    s.pendingPositions.removeRange(0, math.min(sentPositions, s.pendingPositions.length));

    // Protokoll zusammenführen: Server-Zeit und Reihenfolge gewinnen.
    final byId = {for (final a in s.actions) a.id: a};
    for (final raw in (res['actions'] as List? ?? const []).cast<Map>()) {
      final id = raw['id'] as String;
      final time = DateTime.parse(raw['time'] as String).millisecondsSinceEpoch;
      final seq = raw['seq'] as int;
      final existing = byId[id];
      if (existing != null) {
        existing
          ..time = time
          ..seq = seq
          ..synced = true;
      } else {
        final a = LocalAction(
          id: id,
          type: raw['type'] as String,
          payload: (raw['payload'] as Map).cast<String, dynamic>(),
          time: time,
          source: raw['source'] as String,
          seq: seq,
          synced: true,
        );
        s.actions.add(a);
        byId[id] = a;
      }
      s.actionCursor = math.max(s.actionCursor, seq);
    }
    for (final o in (res['outcomes'] as List? ?? const []).cast<Map>()) {
      byId[o['clientId']]?.synced = true;
    }

    for (final raw in (res['messages'] as List? ?? const []).cast<Map>()) {
      final m = ChatMessage(
        id: raw['id'] as int,
        direction: 'to_team',
        kind: raw['kind'] as String,
        sender: raw['sender'] as String?,
        body: raw['body'] as String,
        at: DateTime.parse(raw['created_at'] as String),
      );
      if (s.messages.any((x) => x.id == m.id && x.incoming)) continue;
      s.messages.add(m);
      s.messageCursor = math.max(s.messageCursor, m.id!);
      if (!_incoming.isClosed) _incoming.add(m);
    }
    if (res['sos'] is List) s.sos = (res['sos'] as List).cast<Map>().map((m) => m.cast<String, dynamic>()).toList();
    s.leaderboard = (res['leaderboard'] as List?)?.cast<Map>().map((m) => m.cast<String, dynamic>()).toList();
    s.serverState = (res['state'] as Map?)?.cast<String, dynamic>();
    s.recall = (res['recall'] as Map?)?.cast<String, dynamic>();
    s.lastSyncAt = DateTime.now();
    if (s.eventStatus == 'recalled' && previousStatus != 'recalled') {
      s.recallAcknowledged = false;
      onAlert?.call('recall');
    }
    if (s.eventStatus != 'recalled') s.recallAcknowledged = false;
    _recompute();
  }

  void _updateClock(String? serverTime) {
    if (serverTime == null || session == null) return;
    session!.clockOffsetMs = DateTime.parse(serverTime).millisecondsSinceEpoch - _deviceClock();
  }

  int get unsyncedCount => session?.actions.where((a) => !a.synced && a.source == 'team').length ?? 0;

  Future<void> _save() {
    final s = session;
    if (s == null) return Future.value();
    // Speichervorgänge nacheinander, nie gleichzeitig.
    return _saving = _saving.then((_) => store.save(s)).catchError((_) {});
  }
}
