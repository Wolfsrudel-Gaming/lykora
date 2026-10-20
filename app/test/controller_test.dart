// Tests der Spielsteuerung. Ohne Netz läuft alles gegen einen nachgebauten Server;
// mit LYKORA_TEST_SERVER (und LYKORA_TEST_ADMIN=email:passwort) zusätzlich gegen einen echten.

import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:lykora/data/api.dart';
import 'package:lykora/data/controller.dart';
import 'package:lykora/data/session.dart';
import 'package:lykora/data/tags.dart';

final _gameJson = jsonDecode(File('../spec/v0.1/examples/testspiel.json').readAsStringSync()) as Map<String, dynamic>;

/// Nachgebauter Server mit umschaltbarem Netz.
class FakeServer {
  bool online = true;
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
            res = {'serverTime': DateTime.now().toUtc().toIso8601String(), 'event': event, 'team': team, 'supervisorRequired': true, 'staffTags': [], 'game': _gameJson};
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
              'recall': status == 'recalled' ? {'assemblyPoint': _gameJson['field']['assemblyPoint']} : null,
            };
          case '/play/sos':
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

void main() {
  test('erkennt Einstiegs-QR, Links und reine Codes', () {
    expect(parseJoinCode('lykora://join?server=https%3A%2F%2Fexample.org%2Flykora&code=k7m2qx'), (server: 'https://example.org/lykora', code: 'K7M2QX'));
    expect(parseJoinCode('https://example.org/lykora/join/K7M2QX'), (server: 'https://example.org/lykora', code: 'K7M2QX'));
    expect(parseJoinCode('k7m2qx'), (server: null, code: 'K7M2QX'));
    expect(parseJoinCode('kein code!'), isNull);
  });

  test('rechnet Armband-Hashes wie der Server', () {
    // Gleicher Wert wie tagHash("…0001", "04:a1:b2:c3:d4:e5:f6") in server/src/lib/crypto.ts
    expect(tagHash('00000000-0000-0000-0000-000000000001', '04:a1:b2:c3:d4:e5:f6'), 'b306d7d0101a329c0dbab32393b3f82b00bf73ef156b4a8c6dd9b5cb4a5eccb0');
  });

  test('spielt offline weiter und holt Aktionen und SOS nach', () async {
    final server = FakeServer();
    final c = await newController(server);
    expect(c.hasGame, isTrue);
    expect(c.eventRunning, isTrue);

    await c.start();
    expect((await c.triggerByCode('qr', 'LYK-BRIEFING'))!.ok, isTrue);
    final r = await c.answer('briefing', {'choice': [0]});
    expect(r.ok, isTrue);
    expect(c.state.solved.keys, ['briefing']);
    expect(c.state.items, ['uv-lampe']);

    server.online = false;
    await c.sync();
    expect(c.online, isFalse);
    expect(c.unsyncedCount, 3);
    await c.onPosition(50.8160, 7.1565, 8);
    // GPS-Auslöser am Baum greift offline
    expect(c.state.triggered, contains('baum'));
    await c.answer('baum', {'text': 'Eule'});
    expect(c.state.fragments, ['f1']);
    expect(await c.sos(message: 'Knöchel'), isFalse);
    expect(c.sosPending, isTrue);
    expect(c.sosSmsText(message: 'Knöchel'), startsWith('LYKORA SOS K7M2QX AB3D 50.81600,7.15650 Knöchel'));

    server.online = true;
    await c.sync();
    expect(c.online, isTrue);
    expect(c.unsyncedCount, 0);
    expect(server.sos.single['deferred'], isTrue);
    expect((server.syncs.last['positions'] as List), isNotEmpty);
    // Nach dem Abgleich bleibt der Stand gleich, jetzt mit Server-Reihenfolge.
    expect(c.state.solved.keys.toSet(), {'briefing', 'baum'});
  });

  test('warnt vor Sperrzonen und erkennt den Rückruf', () async {
    final server = FakeServer();
    final c = await newController(server);
    final alerts = <String>[];
    c.onAlert = alerts.add;
    await c.start();
    await c.onPosition(50.8166, 7.155, 5);
    expect(c.zoneAlert?.inside, isFalse);
    await c.onPosition(50.8169, 7.155, 5);
    expect(c.zoneAlert?.inside, isTrue);
    server.status = 'recalled';
    await c.sync();
    expect(c.recalled, isTrue);
    expect(alerts, containsAll(['zone_near', 'zone_inside', 'recall']));
  });

  test('übersteht einen Neustart der App', () async {
    final server = FakeServer();
    final c = await newController(server);
    await c.start();
    await c.triggerByCode('qr', 'LYK-BRIEFING');
    await Future<void>.delayed(const Duration(milliseconds: 50));
    final again = GameController(store: c.store, apiFactory: (s, t) => Api(s, token: t, client: server.client()));
    await again.load();
    expect(again.state.triggered, ['briefing']);
    expect(again.session!.teamName, 'Füchse');
  });

  final live = Platform.environment['LYKORA_TEST_SERVER'];
  test('spielt gegen einen echten Server', () async {
    final admin = Platform.environment['LYKORA_TEST_ADMIN']!.split(':');
    final orga = Api(live!);
    final login = await orga.post('/auth/login', {'email': admin[0], 'password': admin[1]});
    orga.token = login['token'] as String;
    final me = await orga.get('/me');
    final orgId = ((me['orgs'] as List).first as Map)['id'];
    final g = await orga.post('/orgs/$orgId/games', {'content': _gameJson});
    final ev = await orga.post('/orgs/$orgId/events', {'gameId': g['id'], 'name': 'App-Test'});
    await orga.post('/events/${ev['id']}/start', {});

    final dir = await Directory.systemTemp.createTemp('lykora-live-');
    final c = GameController(store: SessionStore(dir));
    final pin = ev['supervisorPin'] as String;
    await c.join(server: live, code: (ev['join'] as Map)['code'] as String, teamName: 'Live-${DateTime.now().millisecondsSinceEpoch}', supervisorPin: pin);
    await c.start();
    await c.triggerByCode('qr', 'LYK-BRIEFING');
    await c.answer('briefing', {'choice': [0]});
    await c.sync();
    expect(c.online, isTrue, reason: c.lastError);
    expect(c.unsyncedCount, 0);
    expect(c.session!.serverState!['solved'], ['briefing']);
    expect(c.session!.serverState!['points'], c.state.points);

    // Eingriff der Spielleitung kommt in der App an
    await orga.post('/events/${ev['id']}/teams/${c.session!.teamId}/actions', {'type': 'staff_points', 'payload': {'amount': 7}});
    await orga.post('/events/${ev['id']}/messages', {'teamId': c.session!.teamId, 'body': 'Weiter so!'});
    await c.sync();
    expect(c.state.points, 57);
    expect(c.session!.messages.map((m) => m.body), contains('Weiter so!'));
    expect(await c.sos(message: 'Test'), isTrue);
  }, skip: live == null ? 'LYKORA_TEST_SERVER nicht gesetzt' : false);
}

