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
  FakeServer({Map<String, dynamic>? game}) : game = game ?? gameJson;

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

  /// WLAN mit Anmeldeseite: Jede Adresse liefert 200 und HTML.
  bool captivePortal = false;

  /// Hält den Abgleich an, bis der Test ihn freigibt, z. B. um mitten hinein anzustupsen.
  Completer<void>? holdSync;

  /// Inhalt jeder Mediendatei: ein paar Bytes reichen, abgespielt wird im Test nichts.
  static final mediaBytes = utf8.encode('OggS-test');
  String status = 'running';
  final startedAt = DateTime.now().toUtc().subtract(const Duration(minutes: 1)).toIso8601String();
  int seq = 0;

  Map<String, dynamic> get event => {'id': 'ev1', 'name': 'Test', 'status': status, 'startedAt': startedAt, 'endedAt': null, 'pauses': []};
  Map<String, dynamic> team = {'id': 't1', 'name': 'Füchse', 'deviceCode': 'AB3D', 'supervisorPresent': true, 'members': []};

  http.Client client() => MockClient((req) async {
    if (!online) throw const SocketException('offline');
    if (captivePortal) return http.Response('<html>Bitte anmelden</html>', 200, headers: {'content-type': 'text/html; charset=utf-8'});
    if (req.method == 'GET' && req.url.path.startsWith('/lykora/media/')) {
      mediaRequests.add(req.url.path);
      if (missingMedia.contains(req.url.path)) return http.Response('{"error":"not_found"}', 404);
      return http.Response.bytes(mediaBytes, 200, headers: {'content-type': 'audio/ogg'});
    }
    final body = req.body.isEmpty ? <String, dynamic>{} : jsonDecode(req.body) as Map<String, dynamic>;
    final path = req.url.path.replaceFirst('/lykora/api', '');
    Map<String, dynamic> res;
    switch (path) {
      case '/join':
        res = {'token': 'tok', 'eventId': '00000000-0000-0000-0000-000000000001', 'team': team};
      case '/play/game':
        res = {'serverTime': DateTime.now().toUtc().toIso8601String(), 'event': event, 'team': team, 'supervisorRequired': true, 'staffTags': [], 'game': game};
      case '/play/supervisor':
        team = {...team, 'supervisorPresent': true};
        res = team;
      case '/play/sync':
        syncs.add(body);
        await holdSync?.future;
        final delivered = [
          for (final m in pendingMessages) {'id': ++_messageId, 'created_at': DateTime.now().toUtc().toIso8601String(), 'sender': 'hq', ...m},
        ];
        pendingMessages.clear();
        final actions = [
          for (final a in (body['actions'] as List).cast<Map>())
            {'seq': ++seq, 'id': a['id'], 'source': 'team', 'type': a['type'], 'payload': a['payload'], 'time': a['time']},
        ];
        res = {
          'serverTime': DateTime.now().toUtc().toIso8601String(),
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

Future<GameController> newController(FakeServer server, {bool backgroundLoops = true}) async {
  final dir = await Directory.systemTemp.createTemp('lykora-test-');
  final c = GameController(
    store: SessionStore(dir),
    apiFactory: (s, t) => Api(s, token: t, client: server.client()),
    backgroundLoops: backgroundLoops,
  );
  await c.join(server: 'https://example.org/lykora', code: 'K7M2QX', teamName: 'Füchse');
  return c;
}

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
