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
import 'tags.dart';

const _uuid = Uuid();

/// Warnung zu einer Sperrzone oder zur Spielfeldgrenze.
class ZoneAlert {
  ZoneAlert(this.message, {required this.inside});
  final String message;
  final bool inside;
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
  GameController({required this.store, Api Function(String server, String? token)? apiFactory, int Function()? clock})
      : _apiFactory = apiFactory ?? ((s, t) => Api(s, token: t)),
        _deviceClock = clock ?? (() => DateTime.now().millisecondsSinceEpoch);

  final SessionStore store;
  final Api Function(String server, String? token) _apiFactory;
  final int Function() _deviceClock;

  Session? session;
  Game? game;
  Api? _api;
  TeamState _state = TeamState();
  Timer? _syncTimer;
  Timer? _tick;
  bool syncing = false;
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

  /// Wird bei neuen Nachrichten aufgerufen, damit die Oberfläche vibrieren oder vorlesen kann.
  void Function(ChatMessage message)? onIncomingMessage;

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
    _api = _apiFactory(s.server, s.token);
  }

  /// Startet den regelmäßigen Abgleich und die Zeitprüfung.
  void startLoops() {
    _tick?.cancel();
    _tick = Timer.periodic(const Duration(seconds: 1), (_) => notifyListeners());
    _scheduleSync(const Duration(seconds: 1));
  }

  void stopLoops() {
    _tick?.cancel();
    _syncTimer?.cancel();
  }

  @override
  void dispose() {
    stopLoops();
    super.dispose();
  }

  /// Neues Team anlegen oder mit [deviceCode] einem bestehenden Team beitreten.
  Future<void> join({
    required String server,
    required String code,
    String? deviceCode,
    String? teamName,
    String? color,
    List<Member> members = const [],
    String? emergencyPhone,
    String? supervisorPin,
    String? supervisorTag,
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
          'members': members.map((m) => m.toJson()).toList(),
          if (emergencyPhone != null && emergencyPhone.isNotEmpty) 'emergencyPhone': emergencyPhone,
          if (supervisorPin != null && supervisorPin.isNotEmpty) 'supervisorPin': supervisorPin,
          'supervisorTag': ?supervisorTag,
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
    s.staffTags = (pkg['staffTags'] as List? ?? const []).cast<Map>().map((m) => m.cast<String, dynamic>()).toList();
    s.supervisorRequired = pkg['supervisorRequired'] as bool? ?? false;
    _updateClock(pkg['serverTime'] as String?);
    game = Game(s.gameJson!);
    await _downloadMedia();
    _recompute();
    await _save();
    notifyListeners();
  }

  Future<void> _downloadMedia() async {
    final media = (game!.json['media'] as List? ?? const []).cast<Map>();
    if (media.isEmpty) return;
    final dir = store.mediaDir;
    await dir.create(recursive: true);
    final client = HttpClient();
    try {
      for (final m in media) {
        final src = m['src'] as String;
        final uri = src.startsWith('http') ? Uri.parse(src) : Uri.parse('${session!.server}/$src');
        final file = File('${dir.path}/${m['id']}');
        if (await file.exists()) continue;
        try {
          final req = await client.getUrl(uri);
          final res = await req.close();
          if (res.statusCode == 200) await res.pipe(file.openWrite());
        } catch (_) {
          // Fehlende Medien verhindern das Spiel nicht.
        }
      }
    } finally {
      client.close();
    }
  }

  File? mediaFile(String id) {
    final f = File('${store.mediaDir.path}/$id');
    return f.existsSync() ? f : null;
  }

  /// Team verlassen und alle lokalen Daten löschen.
  Future<void> leave() async {
    stopLoops();
    await store.clear();
    session = null;
    game = null;
    _state = TeamState();
    notifyListeners();
  }

  // ---------------------------------------------------------------------------
  // Spielstand

  int? get eventStartedAt {
    final started = session?.event['startedAt'] as String?;
    if (started != null) return DateTime.parse(started).millisecondsSinceEpoch;
    return session?.localStartAt;
  }

  bool get eventRunning {
    final status = session?.eventStatus;
    return status == 'running' || (status == 'draft' && session?.localStartAt != null);
  }

  bool get eventEnded => session?.eventStatus == 'ended';
  bool get recalled => session?.eventStatus == 'recalled';
  bool get paused => session?.eventStatus == 'paused';
  bool get supervisorMissing => (session?.supervisorRequired ?? false) && !(session?.supervisorPresent ?? false);
  List<String> get memberTags => session?.members.map((m) => m.tag).whereType<String>().toList() ?? const [];

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
      staffTags: s.staffTags.map((t) => t['hash'] as String).toList(),
      memberTags: memberTags,
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
        final match = (type == 'qr' && t.type == 'qr' && t.code == value) ||
            (type == 'nfc' && t.type == 'nfc' && normalizeTagId(t.tag ?? '') == normalizeTagId(value) && value.isNotEmpty) ||
            (type == 'manual' && t.type == 'manual' && t.code == value);
        if (match) return trigger(s.id, type);
      }
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // NFC-Armbänder

  String hashTag(String uid) => tagHash(session!.eventId, uid);

  /// Rolle eines gescannten Armbands: staff, supervisor, member oder null.
  String? tagRole(String hash) {
    for (final t in session!.staffTags) {
      if (t['hash'] == hash) return t['role'] as String;
    }
    if (memberTags.contains(hash)) return 'member';
    return null;
  }

  Member? memberByTag(String hash) {
    for (final m in session!.members) {
      if (m.tag == hash) return m;
    }
    return null;
  }

  /// Betreuer bestätigt eine Station mit seinem Armband.
  Future<ActionResult> tagSolve(String stationId, String hash) => record('tag_solve', {'station': stationId, 'tag': hash});

  /// Betreuer ist dabei: zählt sofort lokal, der Server bestätigt beim Abgleich.
  Future<bool> confirmSupervisor(String hash) async {
    final role = tagRole(hash);
    if (role != 'staff' && role != 'supervisor') return false;
    session!.team['supervisorPresent'] = true;
    await record('supervisor_tag', {'tag': hash});
    return true;
  }

  /// Ohne Netz kann ein Betreuer den Start per Armband freigeben.
  Future<bool> localStart(String hash) async {
    final role = tagRole(hash);
    if (role != 'staff' && role != 'supervisor') return false;
    session!.localStartAt ??= now() - 1000;
    if (supervisorMissing) session!.team['supervisorPresent'] = true;
    _recompute();
    await _save();
    notifyListeners();
    return true;
  }

  /// Vollzähligkeits-Check: [tags] sind die gescannten Armbänder.
  Future<void> headcount(List<String> tags, String reason) async {
    session!.headcounts[reason] = now();
    await record('headcount', {'tags': tags, 'reason': reason});
  }

  /// Ob gerade ein Vollzähligkeits-Check fällig ist.
  String? get headcountDue {
    final g = game;
    final s = session;
    if (g == null || s == null || !g.safety.headcountEnabled || memberTags.isEmpty) return null;
    final at = g.safety.headcountAt;
    if (recalled && at.contains('recall') && !s.headcounts.containsKey('recall')) return 'recall';
    if (finished && at.contains('finish') && !s.headcounts.containsKey('finish')) return 'finish';
    final interval = g.safety.headcountInterval;
    if (interval != null && started && !finished) {
      final last = s.headcounts.values.fold<int>(_state.startedAt ?? 0, math.max);
      if (now() - last > interval * 1000) return 'interval';
    }
    return null;
  }

  bool get headcountBeforeStart => (game?.safety.headcountEnabled ?? false) && game!.safety.headcountAt.contains('start') && memberTags.isNotEmpty;

  Future<void> updateMembers(List<Member> members) async {
    final s = session!;
    s.team['members'] = members.map((m) => m.toJson()).toList();
    _recompute();
    await _save();
    notifyListeners();
    try {
      final res = await _api!.updateTeam({'members': members.map((m) => m.toJson()).toList()});
      s.team = res;
      await _save();
    } on ApiException catch (e) {
      if (!e.offline) rethrow;
    }
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
        alert = ZoneAlert('Sperrzone „$name“! Sofort zurück.', inside: true);
        break;
      }
      if (d <= z.warnDistance) alert ??= ZoneAlert('Achtung: Sperrzone „$name“ in ${d.round()} m', inside: false);
    }
    if (alert == null && distanceToArea(position!, g.field.boundary) > 0) {
      alert = ZoneAlert('Ihr verlasst das Spielfeld.', inside: false);
    }
    final changed = alert?.message != zoneAlert?.message;
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
    _syncTimer?.cancel();
    _syncTimer = Timer(delay, () => sync());
  }

  /// Gleicht Aktionen, Positionen, SOS, Nachrichten und Fotos mit dem Server ab.
  Future<void> sync() async {
    final s = session;
    if (s == null || syncing) return;
    syncing = true;
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
      if (_tick != null && _tick!.isActive) _scheduleSync(Duration(seconds: delay));
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
      onIncomingMessage?.call(m);
    }
    s.leaderboard = (res['leaderboard'] as List?)?.cast<Map>().map((m) => m.cast<String, dynamic>()).toList();
    s.serverState = (res['state'] as Map?)?.cast<String, dynamic>();
    s.recall = (res['recall'] as Map?)?.cast<String, dynamic>();
    s.lastSyncAt = DateTime.now();
    if (s.eventStatus == 'recalled' && previousStatus != 'recalled') onAlert?.call('recall');
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
