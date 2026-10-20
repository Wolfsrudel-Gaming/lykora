// Gemeinsame Helfer für die Tests: nachgebauter Server mit umschaltbarem Netz.

import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:lykora/data/api.dart';
import 'package:lykora/data/controller.dart';
import 'package:lykora/data/session.dart';

final gameJson = jsonDecode(File('../spec/v0.1/examples/testspiel.json').readAsStringSync()) as Map<String, dynamic>;

/// Nachgebauter Server mit umschaltbarem Netz.
class FakeServer {
  bool online = true;
  bool rejectSos = false;
  final syncs = <Map<String, dynamic>>[];
  final sos = <Map<String, dynamic>>[];
  final messages = <Map<String, dynamic>>[];
  String status = 'running';
  final startedAt = DateTime.now().toUtc().subtract(const Duration(minutes: 1)).toIso8601String();
  int seq = 0;

  Map<String, dynamic> get event => {'id': 'ev1', 'name': 'Test', 'status': status, 'startedAt': startedAt, 'endedAt': null, 'pauses': []};
  Map<String, dynamic> team = {'id': 't1', 'name': 'Füchse', 'deviceCode': 'AB3D', 'supervisorPresent': true, 'members': []};

  http.Client client() => MockClient((req) async {
        if (!online) throw const SocketException('offline');
        final body = req.body.isEmpty ? <String, dynamic>{} : jsonDecode(req.body) as Map<String, dynamic>;
        final path = req.url.path.replaceFirst('/lykora/api', '');
        Map<String, dynamic> res;
        switch (path) {
          case '/join':
            res = {'token': 'tok', 'eventId': '00000000-0000-0000-0000-000000000001', 'team': team};
          case '/play/game':
            res = {'serverTime': DateTime.now().toUtc().toIso8601String(), 'event': event, 'team': team, 'supervisorRequired': true, 'staffTags': [], 'game': gameJson};
          case '/play/sync':
            syncs.add(body);
            final actions = [
              for (final a in (body['actions'] as List).cast<Map>()) {'seq': ++seq, 'id': a['id'], 'source': 'team', 'type': a['type'], 'payload': a['payload'], 'time': a['time']},
            ];
            res = {
              'serverTime': DateTime.now().toUtc().toIso8601String(),
              'event': event,
              'team': team,
              'actions': actions,
              'outcomes': [for (final a in actions) {'clientId': a['id'], 'status': 'ok'}],
              'messages': [],
              'leaderboard': null,
              'recall': status == 'recalled' ? {'assemblyPoint': gameJson['field']['assemblyPoint']} : null,
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

Future<GameController> newController(FakeServer server) async {
  final dir = await Directory.systemTemp.createTemp('lykora-test-');
  final c = GameController(store: SessionStore(dir), apiFactory: (s, t) => Api(s, token: t, client: server.client()));
  await c.join(server: 'https://example.org/lykora', code: 'K7M2QX', teamName: 'Füchse');
  return c;
}

