import 'dart:async';
import 'dart:io';
import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:uuid/uuid.dart';

import '../engine/geo.dart';
import '../engine/team_state.dart';
import '../engine/zones.dart';
import '../model/game.dart';
import 'api.dart';
import 'session.dart';
import '../services/live.dart';
import '../services/nfc.dart' show normalizeTagId;

export '../engine/zones.dart' show ZoneAlert;

const _uuid = Uuid();

/// Eine Position, die älter ist, gilt nicht mehr als aktuell (Ortung aus, Tunnel, dichter Wald).
const positionStaleAfter = Duration(seconds: 20);

/// Wartezeit zwischen den Versuchen, einen SOS zu senden: verdoppelt sich, bleibt aber knapp.
const sosRetryFirst = Duration(seconds: 3);
const sosRetryMax = Duration(seconds: 30);

/// So viele Positionen gehen höchstens in einen Abgleich, damit er im schwachen Netz durchkommt.
const maxPositionsPerSync = 500;

/// Antworten, die länger brauchen, sagen nichts Genaues über die Uhr des Servers.
const maxClockRoundTrip = Duration(seconds: 3);

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

/// Ergebnis einer Aktion für die Oberfläche.
class ActionResult {
  ActionResult(this.outcome, this.state);
  final Outcome? outcome;
  final TeamState state;
  bool get ok => outcome?.ok ?? false;
}

/// Wie ein SOS ausgegangen ist.
enum SosOutcome {
  /// Der Server hat den Alarm bestätigt.
  delivered,

  /// Noch nicht beim Server, aber gespeichert: Die App versucht es weiter (3 s, 6 s … höchstens alle 30 s).
  queued,

  /// Der Server hat den Alarm geprüft und abgelehnt. Er geht nicht mehr raus; Anruf und SMS bleiben der Weg.
  rejected,

  /// Nichts gesendet und nichts gespeichert, z. B. ohne Sitzung. Anruf und SMS bleiben der Weg.
  failed,
}

/// Ergebnis von [GameController.sos] für die Oberfläche.
class SosResult {
  const SosResult(this.outcome, {this.id, this.reason, this.failure});
  final SosOutcome outcome;

  /// Kennung des Alarms, auch für [GameController.sosStatus] und [GameController.sosInfo]
  final String? id;

  /// Satz für die Oberfläche, warum es nicht geklappt hat; null bei [SosOutcome.delivered]
  final String? reason;
  final ApiFailureKind? failure;

  bool get delivered => outcome == SosOutcome.delivered;

  /// Nur dann darf die Seite „wird nachgeholt“ sagen.
  bool get queued => outcome == SosOutcome.queued;
  bool get rejected => outcome == SosOutcome.rejected;

  /// Der Alarm ist nicht beim Server: Anruf und SMS sofort anbieten.
  bool get needsFallback => !delivered;
}

enum SosPhase { queued, rejected, delivered }

/// Stand eines SOS auf diesem Handy.
class SosInfo {
  const SosInfo(this.phase, {this.attempts = 0, this.lastAttemptAt, this.nextAttemptAt, this.reason});
  final SosPhase phase;
  final int attempts;
  final DateTime? lastAttemptAt;

  /// Nächster geplanter Versuch; null, wenn nichts mehr geplant ist
  final DateTime? nextAttemptAt;
  final String? reason;
}

/// Fortschritt beim Laden der Medien des Spiels (Klänge, Bilder).
class MediaProgress {
  const MediaProgress({this.total = 0, this.done = 0, this.bytes = 0, this.running = false});
  final int total;

  /// Dateien, die auf dem Gerät liegen
  final int done;

  /// Größe der Dateien auf dem Gerät in Byte
  final int bytes;
  final bool running;

  int get missing => total - done;
  bool get complete => missing <= 0;

  /// 0 bis 1; ohne Medien 1
  double get fraction => total == 0 ? 1 : done / total;
}

/// Hält die Sitzung, rechnet den Spielstand lokal und gleicht mit dem Server ab.
///
/// Jede Handlung des Teams wird sofort lokal ausgewertet und gespeichert. Der Abgleich
/// läuft im Hintergrund, sobald Netz da ist; der Server entscheidet am Ende.
class GameController extends ChangeNotifier {
  /// [clock] liefert die Uhrzeit des Handys in ms seit Epoche; alle Zeitentscheidungen laufen darüber, Tests stellen sie selbst.
  GameController({
    required this.store,
    Api Function(String server, String? token)? apiFactory,
    int Function()? clock,
    this.backgroundLoops = true,
    this.connectLive,
  }) : _apiFactory = apiFactory ?? ((s, t) => Api(s, token: t)),
       _deviceClock = clock ?? (() => DateTime.now().millisecondsSinceEpoch) {
    _clock = ValueNotifier(_deviceClock());
  }

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
  Timer? _sosTimer;
  Timer? _tick;
  LiveLink? _live;
  bool syncing = false;

  /// Während eines Abgleichs angestupst: direkt danach noch einmal abgleichen.
  bool _syncAgain = false;
  bool online = false;

  /// Letzter Fehler beim Abgleich, auch wenn nur Nachrichten oder Fotos nicht durchkamen. Bleibt stehen, bis es wieder klappt.
  String? lastError;

  /// Art des letzten Fehlers beim Abgleich; [ApiFailureKind.unauthorized] heißt: Dieses Handy ist nicht mehr angemeldet.
  ApiFailureKind? lastFailure;
  int _failures = 0;

  /// Was in diesem Abgleich bei Nachrichten oder Fotos schiefging
  String? _flushError;
  Future<void> _saving = Future.value();

  late final ValueNotifier<int> _clock;

  /// Uhrzeit des Spiels in ms (Handy-Uhr plus Abweichung zum Server), jede Sekunde neu. Wer nur die Uhr anzeigt,
  /// hört hier zu; der Controller selbst meldet sich nur bei echten Änderungen.
  ValueListenable<int> get clock => _clock;
  int _timeSignature = 0;

  GeoPoint? position;
  double? accuracy;

  /// Zeitpunkt des Fixes laut Ortungsdienst
  DateTime? positionAt;
  GeoPoint? _lastRecorded;
  int _lastRecordedAt = 0;
  double? battery;
  ZoneAlert? zoneAlert;
  final _zones = ZoneTracker();

  /// Fehler des Ortungsstroms, sonst null. Verschwindet mit dem nächsten Fix.
  String? locationError;
  final Map<String, int> _triggerAttempts = {};

  /// Laufende Downloads für Cues, damit zwei gleiche Cues die Datei nicht doppelt laden
  final _fetching = <String, Future<bool>>{};

  /// Stand der Medien des Spiels auf dem Gerät und, solange [ensureMedia] läuft, der Fortschritt.
  final mediaProgress = ValueNotifier<MediaProgress>(const MediaProgress());
  Future<void>? _mediaTask;

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

  /// Uhrzeit des Handys als Datum, für Zeitstempel, die nicht an den Server gehen.
  DateTime _wallNow() => DateTime.fromMillisecondsSinceEpoch(_deviceClock());

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
    _zones.reset();
    _refreshMedia();
  }

  /// Das Team steht auf dem Server, aber das Spielpaket fehlt noch (Beitritt abgebrochen): [downloadGame] holt es nach.
  bool get needsPackage => hasSession && !hasGame;

  /// Startet den regelmäßigen Abgleich, die Zeitprüfung und die Verbindung, über die der Server anstupst.
  void startLoops() {
    if (!backgroundLoops) return;
    _tick?.cancel();
    _tick = Timer.periodic(const Duration(seconds: 1), (_) => tick());
    _scheduleSync(const Duration(seconds: 1));
    _scheduleSosRetry();
    final s = session;
    if (s != null && _live == null) {
      _live = LiveLink(uri: liveUri(s.server, s.token), onPoke: _onPoke, connect: connectLive)..start();
    }
    if (hasGame && !mediaProgress.value.complete) unawaited(ensureMedia());
  }

  void stopLoops() {
    _tick?.cancel();
    _syncTimer?.cancel();
    _sosTimer?.cancel();
    _live?.stop();
    _live = null;
  }

  /// Die App kommt in den Vordergrund (oder das Netz ist zurück): gleich abgleichen, wartende SOS senden, Medien nachladen.
  void onAppResumed() {
    if (session == null) return;
    _scheduleSync(const Duration(milliseconds: 300));
    unawaited(flushSos(force: true));
    if (hasGame && !mediaProgress.value.complete) unawaited(ensureMedia());
  }

  /// Ein Takt der Uhr: aktualisiert [clock] und meldet sich nur, wenn sich etwas Zeitabhängiges geändert hat
  /// (Lebenszeichen fällig, Position veraltet, Zeit abgelaufen). Läuft sekündlich, in Tests von Hand.
  void tick() {
    _clock.value = now();
    if (session == null || game == null) return;
    final rest = remaining;
    final signature = (heartbeatDue ? 1 : 0) | (positionFresh ? 2 : 0) | (rest != null && rest <= 0 ? 4 : 0);
    if (signature != _timeSignature) {
      _timeSignature = signature;
      notifyListeners();
    }
  }

  bool _disposed = false;

  @override
  void dispose() {
    _disposed = true;
    stopLoops();
    gameId.dispose();
    mediaProgress.dispose();
    _clock.dispose();
    _incoming.close();
    super.dispose();
  }

  /// Neues Team anlegen oder mit [deviceCode] einem bestehenden Team beitreten.
  ///
  /// Die Sitzung wird gespeichert, sobald der Server das Team angelegt hat, noch vor dem Spielpaket. Bricht der
  /// Beitritt danach ab, setzt ein zweiter Aufruf mit demselben Server und Code die gespeicherte Sitzung fort,
  /// statt ein zweites Team anzulegen. Mit [awaitMedia] false kehrt der Aufruf nach dem Spielpaket zurück;
  /// die Medien laden dann im Hintergrund weiter (siehe [mediaProgress]).
  Future<void> join({
    required String server,
    required String code,
    String? deviceCode,
    String? teamName,
    String? color,
    List<String> members = const [],
    String? emergencyPhone,
    String? supervisorPin,
    bool awaitMedia = true,
  }) async {
    final open = session;
    final resume = open != null && open.gameJson == null && open.server == server && open.eventCode == code;
    if (!resume) {
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
      if (res['token'] is! String || res['eventId'] is! String || res['team'] is! Map) {
        throw ApiException(200, 'not_lykora', 'Hier antwortet kein Lykora-Server. Prüft die Adresse.', kind: ApiFailureKind.notLykora);
      }
      _attach(
        Session(
          server: server,
          token: res['token'] as String,
          eventId: res['eventId'] as String,
          eventCode: code,
          team: (res['team'] as Map).cast<String, dynamic>(),
        ),
      );
      await _save();
    }
    await downloadGame(awaitMedia: awaitMedia);
  }

  /// Lädt das Spielpaket und danach die Medien, damit das Spiel offline läuft.
  Future<void> downloadGame({bool awaitMedia = true}) async {
    final s = session!;
    final sent = _deviceClock();
    final pkg = await _api!.game();
    if (pkg['game'] is! Map || pkg['event'] is! Map || pkg['team'] is! Map) {
      throw ApiException(200, 'not_lykora', 'Hier antwortet kein Lykora-Server. Prüft die Adresse.', kind: ApiFailureKind.notLykora);
    }
    s.gameJson = (pkg['game'] as Map).cast<String, dynamic>();
    s.event = (pkg['event'] as Map).cast<String, dynamic>();
    s.team = (pkg['team'] as Map).cast<String, dynamic>();
    s.supervisorRequired = pkg['supervisorRequired'] as bool? ?? false;
    _updateClock(pkg['serverTime'] as String?, sent, _deviceClock());
    game = Game(s.gameJson!);
    gameId.value = game!.id;
    _refreshMedia();
    _recompute();
    // Das Paket steht, bevor die Medien kommen: Ein Abbruch beim Laden der Klänge kostet das Spiel nichts.
    await _save();
    notifyListeners();
    final media = ensureMedia();
    if (awaitMedia) await media;
  }

  // ---------------------------------------------------------------------------
  // Medien

  /// Zählt, welche Medien des Spiels auf dem Gerät liegen.
  void _refreshMedia({bool running = false}) {
    if (_disposed) return;
    final list = game?.mediaList ?? const [];
    var done = 0;
    var bytes = 0;
    for (final m in list) {
      final f = File('${store.mediaDir.path}/${m.id}');
      if (f.existsSync()) {
        done++;
        bytes += f.lengthSync();
      }
    }
    mediaProgress.value = MediaProgress(total: list.length, done: done, bytes: bytes, running: running);
  }

  /// Lädt die Medien nach, die noch fehlen. Mehrfaches Aufrufen startet keinen zweiten Lauf; fehlende Dateien
  /// verhindern das Spiel nicht. Wird beim Beitritt, beim Start der Schleifen, bei Rückkehr in die App,
  /// bei zurückgekehrtem Netz und per [retryMedia] aufgerufen.
  Future<void> ensureMedia() => _mediaTask ??= _downloadMedia().whenComplete(() => _mediaTask = null);

  /// Noch einmal versuchen, was fehlt (Knopf „Nochmal laden“).
  Future<void> retryMedia() => ensureMedia();

  /// Wartet auf den laufenden Medien-Lauf, falls einer läuft.
  Future<void> waitForMedia() => _mediaTask ?? Future.value();

  /// Anzahl der Medien, die auf dem Gerät noch fehlen.
  int get missingMedia => mediaProgress.value.missing;

  Future<void> _downloadMedia() async {
    final s = session;
    final api = _api;
    final media = game?.mediaList ?? const [];
    if (s == null || api == null || media.isEmpty) return;
    _refreshMedia(running: true);
    final dir = store.mediaDir;
    await dir.create(recursive: true);
    var failedInRow = 0;
    for (final m in media) {
      // Nach leave() nichts mehr ablegen.
      if (session != s) return;
      final file = File('${dir.path}/${m.id}');
      if (await file.exists()) continue;
      if (await api.download(m.src, file)) {
        failedInRow = 0;
      } else if (++failedInRow >= 3) {
        // Drei Fehlschläge hintereinander: wohl kein Netz. Der nächste Lauf versucht es wieder.
        break;
      }
      if (session == s) _refreshMedia(running: true);
    }
    if (session != s || _disposed) return;
    _refreshMedia();
    notifyListeners();
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
    if (ok && inGame) _refreshMedia(running: mediaProgress.value.running);
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
    zoneAlert = null;
    _zones.reset();
    mediaProgress.value = const MediaProgress();
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
    // Ein veralteter Standort gehört nicht in eine Aktion: Der Server hielte ihn für den jetzigen.
    if (position != null && positionFresh && !p.containsKey('location')) {
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
            (type == 'manual' && t.type == 'manual' && _sameCode(t.code, value));
        if (match) return trigger(s.id, type);
      }
    }
    return null;
  }

  /// Manuell eingetippte Codes: Groß- und Kleinschreibung und Leerzeichen am Rand zählen nicht.
  bool _sameCode(String? expected, String typed) => expected != null && expected.trim().toUpperCase() == typed.trim().toUpperCase();

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
    var open = visibleStations.where((s) => !_state.solved.containsKey(s.id) && (!s.isFinal || fragmentsComplete())).toList();
    if (open.isEmpty) return null;
    // Eine Station, die auf die Prüfung der Spielleitung wartet, hält den Peiler nicht fest. Bleibt nur sie übrig, zeigt er weiter dorthin.
    final unreviewed = open.where((s) => !_state.pendingReviews.contains(s.id)).toList();
    if (unreviewed.isNotEmpty) open = unreviewed;
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
    session!.messages.add(ChatMessage(direction: 'to_team', kind: kind, sender: 'hq', body: text, at: _wallNow()));
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

  /// Wie alt der letzte Fix ist; null, solange noch keiner kam.
  Duration? get positionAge {
    final at = positionAt;
    if (at == null) return null;
    final ms = _deviceClock() - at.millisecondsSinceEpoch;
    return Duration(milliseconds: ms < 0 ? 0 : ms);
  }

  /// Es gibt einen Fix und er ist nicht älter als [positionStaleAfter]. Nur dann taugt die Position für Entscheidungen.
  bool get positionFresh {
    final age = positionAge;
    return age != null && age <= positionStaleAfter;
  }

  /// Es gibt eine Position, aber sie ist veraltet („Signal verloren“).
  bool get positionStale => position != null && !positionFresh;

  /// Neue GPS-Position vom Ortungsdienst.
  Future<void> onPosition(double lat, double lon, double acc, {DateTime? at}) async {
    final s = session;
    if (s == null || game == null) return;
    final fixAt = at ?? _wallNow();
    final last = positionAt;
    // Ein Nachzügler, der älter ist als der letzte Fix, sagt nichts Neues.
    if (last != null && fixAt.isBefore(last)) return;
    position = GeoPoint(lat, lon);
    accuracy = acc;
    positionAt = fixAt;
    locationError = null;
    final fresh = positionFresh;
    final t = now() - positionAge!.inMilliseconds;

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

    // Ein alter Fix (zwischengespeichert beim Start der Ortung) löst weder Zonenalarm noch Station aus.
    if (fresh) {
      _checkZones();
      if (eventRunning && started && !finished) await _autoTrigger(t);
    }
    notifyListeners();
  }

  /// Der Ortungsstrom meldet einen Fehler (Ortung ausgeschaltet, Erlaubnis entzogen).
  void onPositionError(Object error) {
    locationError = 'Die Ortung meldet einen Fehler. Ist der Standort eingeschaltet?';
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
    final update = _zones.update(game!, position!, accuracy ?? 0, _deviceClock());
    zoneAlert = update.alert;
    for (final kind in update.alarms) {
      onAlert?.call(kind);
    }
  }

  // ---------------------------------------------------------------------------
  // Nachrichten

  Future<void> sendMessage(String body, {String kind = 'chat'}) async {
    final s = session!;
    final msg = ChatMessage(direction: 'from_team', kind: kind, body: body, at: _wallNow(), clientId: _uuid.v4(), pending: true);
    s.messages.add(msg);
    await _save();
    notifyListeners();
    await _flushMessages();
  }

  /// Schickt wartende Nachrichten. Ein Serverfehler oder fehlendes Netz lässt sie warten (der nächste Abgleich
  /// versucht es wieder); nur eine Ablehnung des Servers verwirft sie, sichtbar als [ChatMessage.failed].
  Future<void> _flushMessages() async {
    final s = session;
    if (s == null) return;
    for (final m in s.messages.where((m) => m.pending && !m.failed).toList()) {
      try {
        await _api!.message({'id': m.clientId, 'body': m.body, 'kind': m.kind});
        m.pending = false;
      } on ApiException catch (e) {
        _noteFlushFailure(e.retryable ? 'Nachricht noch nicht gesendet' : 'Nachricht nicht angenommen', e);
        if (e.retryable) break;
        m.pending = false;
        m.failed = true;
      }
    }
    await _save();
    notifyListeners();
  }

  /// Merkt einen Fehler beim Senden von Nachrichten, Fotos oder SOS. Er bleibt in [lastError] stehen,
  /// bis ein Abgleich ohne solche Fehler durchläuft.
  void _noteFlushFailure(String what, ApiException e) {
    _flushError = '$what: ${e.message}';
    lastError = _flushError;
    lastFailure = e.kind;
    if (!e.reachable) online = false;
  }

  // ---------------------------------------------------------------------------
  // SOS

  /// Felder eines wartenden SOS, die nur auf dem Handy stehen und nicht zum Server gehen.
  static const _sosLocalKeys = {'attempts', 'nextTryAt', 'lastAttemptAt', 'rejected', 'reason'};

  Future<void> _sosLane = Future.value();

  /// Alle Sendeversuche laufen nacheinander, damit derselbe Alarm nie zweimal gleichzeitig unterwegs ist.
  Future<T> _inSosLane<T>(Future<T> Function() job) {
    final next = _sosLane.then((_) => job());
    _sosLane = next.then((_) {}, onError: (_) {});
    return next;
  }

  /// Löst SOS aus.
  ///
  /// Der Alarm steht gespeichert in der Warteschlange, bevor das erste Mal gesendet wird; er übersteht damit
  /// auch einen Absturz oder Prozessende mitten im Senden. Bestätigt der Server, ist er [SosOutcome.delivered].
  /// Bei fehlendem Netz, Fehler 5xx, 401, 429, Zeitüberschreitung oder einer Anmeldeseite im WLAN bleibt er
  /// [SosOutcome.queued] und wird mit wachsendem Abstand (3 s bis höchstens 30 s) wiederholt. Nur eine
  /// Ablehnung durch den Server (400/422) ist [SosOutcome.rejected].
  Future<SosResult> sos({String? message}) async {
    final s = session;
    if (s == null || _api == null) return const SosResult(SosOutcome.failed, reason: 'Keine Sitzung auf diesem Handy. Bitte anrufen.');
    final entry = <String, dynamic>{
      'id': _uuid.v4(),
      'time': DateTime.fromMillisecondsSinceEpoch(now()).toUtc().toIso8601String(),
      if (position != null) 'lat': position!.lat,
      if (position != null) 'lon': position!.lon,
      if (accuracy != null) 'accuracy': accuracy,
      if (message != null && message.isNotEmpty) 'message': message,
      'attempts': 0,
    };
    // Damit die SOS-Seite zeigen kann, ob die Spielleitung den Alarm gelesen hat.
    s.lastSosId = entry['id'] as String;
    s.pendingSos.add(entry);
    await _save();
    notifyListeners();
    final result = await _inSosLane(() => _attemptSos(entry));
    // Kam der Alarm durch, ist das Netz da: Älteres, das noch wartet, gleich mitschicken.
    if (result.delivered && sosPending) unawaited(flushSos(force: true));
    return result;
  }

  /// Wartende SOS senden. Ohne [force] nur die, deren Wartezeit abgelaufen ist.
  Future<void> flushSos({bool force = false}) => _inSosLane(() async {
    final s = session;
    if (s == null) return;
    for (final entry in s.pendingSos.toList()) {
      if (entry['rejected'] == true) continue;
      if (!force && (entry['nextTryAt'] as int? ?? 0) > _deviceClock()) continue;
      final result = await _attemptSos(entry);
      // Gescheitert heißt meist: kein Netz. Die übrigen scheitern genauso.
      if (result.queued) break;
    }
    _scheduleSosRetry();
  });

  /// Ein Versuch für einen Eintrag der Warteschlange.
  Future<SosResult> _attemptSos(Json entry) async {
    final s = session;
    final api = _api;
    final id = entry['id'] as String;
    if (s == null || api == null) return SosResult(SosOutcome.failed, id: id, reason: 'Keine Sitzung auf diesem Handy. Bitte anrufen.');
    if (entry['rejected'] == true) return SosResult(SosOutcome.rejected, id: id, reason: entry['reason'] as String?);
    // Ein früherer Durchlauf hat ihn schon zugestellt.
    if (!s.pendingSos.contains(entry)) return SosResult(SosOutcome.delivered, id: id);
    final attempts = (entry['attempts'] as int? ?? 0) + 1;
    entry['attempts'] = attempts;
    entry['lastAttemptAt'] = _deviceClock();
    try {
      await api.sos({...entry}..removeWhere((k, _) => _sosLocalKeys.contains(k)));
      s.pendingSos.remove(entry);
      await _save();
      if (!_disposed) notifyListeners();
      return SosResult(SosOutcome.delivered, id: id);
    } on ApiException catch (e) {
      if (e.kind == ApiFailureKind.rejected && (e.status == 400 || e.status == 422)) {
        entry['rejected'] = true;
        entry['reason'] = e.message;
        _noteFlushFailure('SOS nicht angenommen', e);
        await _save();
        if (!_disposed) notifyListeners();
        return SosResult(SosOutcome.rejected, id: id, reason: e.message, failure: e.kind);
      }
      _noteFlushFailure('SOS noch nicht gesendet', e);
      return _sosQueued(entry, attempts, e.message, e.kind);
    } catch (_) {
      return _sosQueued(entry, attempts, 'Der Alarm konnte nicht gesendet werden.', null);
    }
  }

  Future<SosResult> _sosQueued(Json entry, int attempts, String reason, ApiFailureKind? kind) async {
    // Beim Server heißt ein Alarm, der nicht beim ersten Versuch durchkam, „nachgeholt“.
    entry['deferred'] = true;
    entry['reason'] = reason;
    entry['nextTryAt'] = _deviceClock() + _sosBackoff(attempts).inMilliseconds;
    await _save();
    if (!_disposed) notifyListeners();
    _scheduleSosRetry();
    return SosResult(SosOutcome.queued, id: entry['id'] as String, reason: reason, failure: kind);
  }

  /// 3 s, 6 s, 12 s, 24 s, dann alle 30 s.
  Duration _sosBackoff(int attempts) {
    final ms = sosRetryFirst.inMilliseconds * (1 << math.min(attempts - 1, 4));
    return Duration(milliseconds: math.min(ms, sosRetryMax.inMilliseconds));
  }

  void _scheduleSosRetry() {
    _sosTimer?.cancel();
    final s = session;
    if (!backgroundLoops || s == null || _disposed) return;
    int? next;
    for (final entry in s.pendingSos) {
      if (entry['rejected'] == true) continue;
      final at = entry['nextTryAt'] as int? ?? 0;
      if (next == null || at < next) next = at;
    }
    if (next == null) return;
    _sosTimer = Timer(Duration(milliseconds: math.max(next - _deviceClock(), 500)), () => flushSos());
  }

  /// Es wartet mindestens ein SOS auf Zustellung.
  bool get sosPending => sosQueueLength > 0;

  /// Anzahl der SOS, die gespeichert sind und noch zum Server müssen.
  int get sosQueueLength => session?.pendingSos.where((e) => e['rejected'] != true).length ?? 0;

  /// Anzahl der SOS, die der Server abgelehnt hat. Sie gehen nicht mehr raus; Anruf und SMS bleiben der Weg.
  int get sosRejectedCount => session?.pendingSos.where((e) => e['rejected'] == true).length ?? 0;

  /// Zeitpunkt des letzten Sendeversuchs für ein wartendes SOS; null, wenn keins wartet.
  DateTime? get sosLastAttemptAt {
    int? last;
    for (final e in session?.pendingSos ?? const <Json>[]) {
      final at = e['lastAttemptAt'] as int?;
      if (at != null && (last == null || at > last)) last = at;
    }
    return last == null ? null : DateTime.fromMillisecondsSinceEpoch(last);
  }

  /// Stand eines SOS auf diesem Handy: wartet, abgelehnt oder zugestellt. Null ohne Kennung.
  SosInfo? sosInfo(String? id) {
    if (id == null || session == null) return null;
    for (final e in session!.pendingSos) {
      if (e['id'] != id) continue;
      final rejected = e['rejected'] == true;
      DateTime? at(Object? ms) => ms is int ? DateTime.fromMillisecondsSinceEpoch(ms) : null;
      return SosInfo(
        rejected ? SosPhase.rejected : SosPhase.queued,
        attempts: e['attempts'] as int? ?? 0,
        lastAttemptAt: at(e['lastAttemptAt']),
        nextAttemptAt: rejected ? null : at(e['nextTryAt']),
        reason: e['reason'] as String?,
      );
    }
    return const SosInfo(SosPhase.delivered);
  }

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

  /// Schickt wartende Fotos. Bei Netz- oder Serverfehler bleibt die Datei liegen und der nächste Abgleich versucht es
  /// wieder; nur eine Ablehnung (Typ oder Größe) verwirft sie, und das Team erfährt es im Funkprotokoll.
  Future<void> _flushUploads() async {
    final s = session;
    if (s == null) return;
    for (final u in s.pendingUploads.toList()) {
      final file = File('${store.uploadsDir.path}/${u['id']}');
      if (!await file.exists()) {
        s.pendingUploads.remove(u);
        continue;
      }
      try {
        await _api!.upload(u['id'] as String, u['contentType'] as String, await file.readAsBytes());
      } on ApiException catch (e) {
        _noteFlushFailure(e.retryable ? 'Foto noch nicht gesendet' : 'Foto nicht angenommen', e);
        if (e.retryable) break;
        await addLocalRadio('Ein Foto wurde nicht angenommen: ${e.message}');
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
    _flushError = null;
    notifyListeners();
    try {
      await flushSos(force: true);
      final unsynced = s.actions.where((a) => !a.synced && a.source == 'team').toList();
      // Große Rückstände gehen in Stücken, damit der Abgleich im schwachen Netz durchkommt.
      final positions = s.pendingPositions.take(maxPositionsPerSync).toList();
      final moreToSend = s.pendingPositions.length > positions.length;
      final sent = _deviceClock();
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
      // Das Team hat das Spiel verlassen, während die Antwort unterwegs war: Sie gehört niemandem mehr.
      if (session != s) return;
      _applySync(res, positions.length, sent, _deviceClock());
      // Der Rest des Rückstands geht gleich hinterher, aber nur, wenn dieser Teil durchgekommen ist.
      if (moreToSend) _syncAgain = true;
      online = true;
      lastFailure = null;
      await _flushMessages();
      await _flushUploads();
      // Fehler beim Senden von Nachrichten und Fotos bleiben stehen, bis sie behoben sind.
      lastError = _flushError;
      _failures = _flushError == null ? 0 : _failures + 1;
      if (!wasOnline && online) {
        // Netz wieder da: Die Verbindung zum Anstupsen muss nicht erst ihre Pause abwarten, fehlende Medien kommen nach.
        _live?.wake();
        if (hasGame && !mediaProgress.value.complete) unawaited(ensureMedia());
      }
    } on ApiException catch (e) {
      online = e.reachable;
      lastError = e.message;
      lastFailure = e.kind;
      _failures++;
    } catch (e) {
      debugPrint('Abgleich fehlgeschlagen: $e');
      lastError = 'Der Abgleich ist fehlgeschlagen.';
      _failures++;
    } finally {
      syncing = false;
      await _save();
      if (!_disposed) notifyListeners();
      // Mit Netz alle 15 s, ohne Netz seltener, um Akku zu sparen.
      final delay = _failures == 0 ? 15 : math.min(15 * (1 << math.min(_failures, 3)), 120);
      final again = _syncAgain;
      _syncAgain = false;
      // Nach leave() oder stopLoops() nicht weiter abgleichen.
      if (_tick != null && _tick!.isActive) _scheduleSync(again ? Duration.zero : Duration(seconds: delay));
    }
  }

  void _applySync(Json res, int sentPositions, int sentAt, int receivedAt) {
    final s = session!;
    _updateClock(res['serverTime'] as String?, sentAt, receivedAt);
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
    s.lastSyncAt = _wallNow();
    if (s.eventStatus == 'recalled' && previousStatus != 'recalled') {
      s.recallAcknowledged = false;
      onAlert?.call('recall');
    }
    if (s.eventStatus != 'recalled') s.recallAcknowledged = false;
    _recompute();
  }

  /// Setzt die Abweichung zur Server-Uhr aus der Mitte zwischen Senden und Empfang. Antworten, die lange brauchten,
  /// sagen nichts Genaues und werden übersprungen.
  void _updateClock(String? serverTime, int sentAt, int receivedAt) {
    if (serverTime == null || session == null) return;
    if (receivedAt - sentAt > maxClockRoundTrip.inMilliseconds) return;
    session!.clockOffsetMs = DateTime.parse(serverTime).millisecondsSinceEpoch - (sentAt + receivedAt) ~/ 2;
  }

  int get unsyncedCount => session?.actions.where((a) => !a.synced && a.source == 'team').length ?? 0;

  Future<void> _save() {
    final s = session;
    if (s == null) return Future.value();
    // Speichervorgänge nacheinander, nie gleichzeitig.
    return _saving = _saving.then((_) => store.save(s)).catchError((_) {});
  }
}
