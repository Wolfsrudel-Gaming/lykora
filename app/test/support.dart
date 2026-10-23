// Gemeinsame Helfer für die Tests: nachgebauter Server mit umschaltbarem Netz.

import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:lykora/data/api.dart';
import 'package:lykora/data/controller.dart';
import 'package:lykora/data/session.dart';

final gameJson = jsonDecode(File('../spec/v0.1/examples/testspiel.json').readAsStringSync()) as Map<String, dynamic>;

/// Nachgebauter Server mit umschaltbarem Netz.
class FakeServer {
  /// [now] ist die Uhr des Servers; Tests mit eigener Handy-Uhr geben dieselbe hier an.
  FakeServer({Map<String, dynamic>? game, DateTime Function()? now}) : game = game ?? gameJson, now = now ?? DateTime.now {
    startedAt = this.now().toUtc().subtract(const Duration(minutes: 1)).toIso8601String();
  }

  final DateTime Function() now;

  /// Spielpaket, das der Server ausliefert
  final Map<String, dynamic> game;
  bool online = true;
  bool rejectSos = false;

  /// Nachrichten der Zentrale, die beim nächsten Abgleich ankommen.
  final pendingMessages = <Map<String, dynamic>>[];
  List<Map<String, dynamic>>? leaderboard;
  int _messageId = 0;
  final syncs = <Map<String, dynamic>>[];
  final sos = <Map<String, dynamic>>[];

  /// Was die Spielleitung zu einem SOS eingetragen hat, je id des Handys: acknowledgedAt, resolvedAt, acknowledgedBy
  final sosAck = <String, Map<String, dynamic>>{};
  final messages = <Map<String, dynamic>>[];

  /// Abgerufene Mediendateien, z. B. /lykora/media/lib/wind.ogg
  final mediaRequests = <String>[];

  /// Mediendateien, die der Server nicht kennt (404)
  final missingMedia = <String>{};

  /// Abgerufene Kacheln, z. B. /lykora/tiles/sieglar/16/34066/21995.png
  final tileRequests = <String>[];

  /// Welche Kacheln der Server hat; ohne Angabe jede. Alle anderen antworten mit 404.
  bool Function(String pack, int z, int x, int y)? hasTile;

  /// Antwort auf GET /api/tiles; null heißt: Der Server kennt die Route nicht (404).
  List<Map<String, dynamic>>? tilePacks;

  /// WLAN mit Anmeldeseite: Jede Adresse liefert 200 und HTML.
  bool captivePortal = false;

  /// Antwortet auf diese Pfade (z. B. /play/sos, /play/messages, /play/uploads, /join, /media/lib/wind.ogg) mit
  /// einem Fehlerstatus, bis der Eintrag fehlt: 500er, 401, 429, 400. Mit [failTimes] nur die ersten Male.
  final statusFor = <String, int>{};

  /// Wie oft ein Eintrag in [statusFor] und [htmlFor] noch gilt; ohne Eintrag unbegrenzt.
  final failTimes = <String, int>{};

  /// Antwortet auf diese Pfade mit HTML und dem Status (200 wie eine Anmeldeseite, 502 wie ein Proxy).
  final htmlFor = <String, int>{};

  /// Verzögert die Antwort auf diese Pfade, z. B. um ein Zeitlimit zu treffen.
  final delayFor = <String, Duration>{};

  /// Alle Anfragen in der Reihenfolge, als „METHODE /pfad“ ohne Basispfad.
  final calls = <String>[];

  /// Hochgeladene Dateien: id, contentType, Länge
  final uploads = <Map<String, dynamic>>[];

  /// Wie oft /join aufgerufen wurde und wie viele Teams dabei entstanden sind.
  int joinCalls = 0;
  final teamNames = <String>[];

  /// Wie der echte Server: Ein zweites Team mit demselben Namen wird mit 409 abgelehnt.
  bool uniqueTeamNames = false;

  /// Setzt [statusFor] für [path]; mit [times] gilt es nur für die nächsten Anfragen.
  void fail(String path, int status, {int? times}) {
    statusFor[path] = status;
    if (times != null) failTimes[path] = times;
  }

  /// Nimmt alle Fehler und Verzögerungen zurück.
  void heal() {
    statusFor.clear();
    htmlFor.clear();
    failTimes.clear();
    delayFor.clear();
    captivePortal = false;
    rejectSos = false;
    online = true;
  }

  bool _failing(String path) {
    final left = failTimes[path];
    if (left == null) return true;
    if (left <= 0) {
      statusFor.remove(path);
      htmlFor.remove(path);
      failTimes.remove(path);
      return false;
    }
    failTimes[path] = left - 1;
    return true;
  }

  /// Hält den Abgleich an, bis der Test ihn freigibt, z. B. um mitten hinein anzustupsen.
  Completer<void>? holdSync;

  /// Inhalt jeder Kachel: ein durchsichtiges PNG von 1 × 1 Pixel
  static final tileBytes = base64Decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==');

  /// Inhalt jeder Mediendatei: ein paar Bytes reichen, abgespielt wird im Test nichts.
  static final mediaBytes = utf8.encode('OggS-test');
  String status = 'running';
  late final String startedAt;
  int seq = 0;

  Map<String, dynamic> get event => {'id': 'ev1', 'name': 'Test', 'status': status, 'startedAt': startedAt, 'endedAt': null, 'pauses': []};
  Map<String, dynamic> team = {'id': 't1', 'name': 'Füchse', 'deviceCode': 'AB3D', 'supervisorPresent': true, 'members': []};

  http.Response _html(int status) => http.Response('<html>Bitte anmelden</html>', status, headers: {'content-type': 'text/html; charset=utf-8'});

  http.Client client() => MockClient((req) async {
    if (!online) throw const SocketException('offline');
    final isTile = req.method == 'GET' && req.url.path.startsWith('/lykora/tiles/');
    final isMedia = isTile || (req.method == 'GET' && req.url.path.startsWith('/lykora/media/'));
    final path = isMedia ? req.url.path : req.url.path.replaceFirst('/lykora/api', '');
    calls.add('${req.method} $path');
    final delay = delayFor[path];
    if (delay != null) await Future<void>.delayed(delay);
    if (captivePortal) return _html(200);
    if (htmlFor.containsKey(path) && _failing(path)) return _html(htmlFor[path]!);
    if (statusFor.containsKey(path) && _failing(path)) return http.Response('{"error":"x","message":"Server kaputt"}', statusFor[path]!);
    if (isTile) {
      tileRequests.add(req.url.path);
      final m = RegExp(r'^/lykora/tiles/([^/]+)/(\d+)/(\d+)/(\d+)\.png$').firstMatch(req.url.path);
      if (m == null || !(hasTile?.call(m[1]!, int.parse(m[2]!), int.parse(m[3]!), int.parse(m[4]!)) ?? true)) {
        return http.Response('{"error":"not_found"}', 404, headers: {'content-type': 'application/json'});
      }
      return http.Response.bytes(tileBytes, 200, headers: {'content-type': 'image/png'});
    }
    if (isMedia) {
      mediaRequests.add(req.url.path);
      if (missingMedia.contains(req.url.path)) return http.Response('{"error":"not_found"}', 404);
      return http.Response.bytes(mediaBytes, 200, headers: {'content-type': 'audio/ogg'});
    }
    if (path == '/play/uploads') {
      uploads.add({'id': req.url.queryParameters['id'], 'contentType': req.headers['content-type'], 'length': req.bodyBytes.length});
      return http.Response('{"received":true}', 201, headers: {'content-type': 'application/json'});
    }
    if (path == '/tiles' && req.method == 'GET' && tilePacks != null) {
      return http.Response(jsonEncode(tilePacks), 200, headers: {'content-type': 'application/json'});
    }
    final body = req.body.isEmpty ? <String, dynamic>{} : jsonDecode(req.body) as Map<String, dynamic>;
    Map<String, dynamic> res;
    switch (path) {
      case '/join':
        joinCalls++;
        final name = (body['team'] as Map?)?['name'] as String?;
        if (uniqueTeamNames && name != null && teamNames.contains(name)) {
          return http.Response('{"error":"team_name_taken","message":"Diesen Teamnamen gibt es schon"}', 409, headers: {'content-type': 'application/json'});
        }
        if (name != null) teamNames.add(name);
        res = {'token': 'tok', 'eventId': '00000000-0000-0000-0000-000000000001', 'team': team};
      case '/play/game':
        res = {'serverTime': now().toUtc().toIso8601String(), 'event': event, 'team': team, 'supervisorRequired': true, 'staffTags': [], 'game': game};
      case '/play/supervisor':
        team = {...team, 'supervisorPresent': true};
        res = team;
      case '/play/sync':
        syncs.add(body);
        await holdSync?.future;
        final delivered = [
          for (final m in pendingMessages) {'id': ++_messageId, 'created_at': now().toUtc().toIso8601String(), 'sender': 'hq', ...m},
        ];
        pendingMessages.clear();
        final actions = [
          for (final a in (body['actions'] as List).cast<Map>())
            {'seq': ++seq, 'id': a['id'], 'source': 'team', 'type': a['type'], 'payload': a['payload'], 'time': a['time']},
        ];
        res = {
          'serverTime': now().toUtc().toIso8601String(),
          'event': event,
          'team': team,
          'actions': actions,
          'outcomes': [
            for (final a in actions) {'clientId': a['id'], 'status': 'ok'},
          ],
          'messages': delivered,
          'sos': [
            for (final x in sos.reversed)
              {
                'id': 'sos-${x['id']}',
                'clientId': x['id'],
                'channel': x['deferred'] == true ? 'deferred' : 'app',
                'acknowledgedAt': null,
                'resolvedAt': null,
                'acknowledgedBy': null,
                ...?sosAck[x['id']],
              },
          ],
          'leaderboard': leaderboard,
          'recall': status == 'recalled' ? {'assemblyPoint': game['field']['assemblyPoint']} : null,
        };
      case '/play/sos':
        if (rejectSos) return http.Response('{"error":"invalid_request","message":"kaputt"}', 400);
        sos.add(body);
        res = {'received': true};
      case '/play/messages':
        messages.add(body);
        res = {'received': true};
      default:
        return http.Response('{"error":"not_found"}', 404);
    }
    return http.Response(jsonEncode(res), 200, headers: {'content-type': 'application/json'});
  });
}

/// Beigetretener Controller gegen den nachgebauten Server. [clock] ist die Handy-Uhr in ms, [timeout] ersetzt die
/// Zeitlimits der Verbindung (für Tests mit langsamen Antworten).
Future<GameController> newController(FakeServer server, {bool backgroundLoops = true, int Function()? clock, Duration? timeout}) async {
  final dir = await Directory.systemTemp.createTemp('lykora-test-');
  final c = controllerFor(server, dir, backgroundLoops: backgroundLoops, clock: clock, timeout: timeout);
  await c.join(server: 'https://example.org/lykora', code: 'K7M2QX', teamName: 'Füchse');
  return c;
}

/// Controller ohne Beitritt auf einem Ordner, z. B. um nach einem Abbruch neu zu starten.
GameController controllerFor(FakeServer server, Directory dir, {bool backgroundLoops = false, int Function()? clock, Duration? timeout}) => GameController(
  store: SessionStore(dir),
  apiFactory: (s, t) =>
      timeout == null ? Api(s, token: t, client: server.client()) : Api(s, token: t, client: server.client(), connectTimeout: timeout, idleTimeout: timeout),
  backgroundLoops: backgroundLoops,
  clock: clock,
);

/// Lädt die Schriften der App aus pubspec.yaml und die Material-Symbole, damit Tests echte Glyphen messen.
Future<void> loadAppFonts() async {
  final pubspec = File('pubspec.yaml').readAsLinesSync();
  String? family;
  final assets = <String, List<String>>{};
  for (final line in pubspec) {
    final f = RegExp(r'^\s*- family:\s*(.+)$').firstMatch(line);
    if (f != null) family = f.group(1)!.trim();
    final a = RegExp(r'^\s*- asset:\s*(assets/fonts/.+)$').firstMatch(line);
    if (a != null && family != null) assets.putIfAbsent(family, () => []).add(a.group(1)!.trim());
  }
  for (final e in assets.entries) {
    final loader = FontLoader(e.key);
    for (final path in e.value) {
      loader.addFont(Future.value(ByteData.sublistView(File(path).readAsBytesSync())));
    }
    await loader.load();
  }
  final root = Platform.environment['FLUTTER_ROOT'] ?? '/var/tmp/flutter';
  final icons = FontLoader('MaterialIcons')
    ..addFont(Future.value(ByteData.sublistView(File('$root/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf').readAsBytesSync())));
  await icons.load();
}
