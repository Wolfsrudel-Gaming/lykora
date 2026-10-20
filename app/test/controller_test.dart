// Tests der Spielsteuerung. Ohne Netz läuft alles gegen einen nachgebauten Server;
// mit LYKORA_TEST_SERVER (und LYKORA_TEST_ADMIN=email:passwort) zusätzlich gegen einen echten.

import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:lykora/data/api.dart';
import 'package:lykora/data/controller.dart';
import 'package:lykora/data/session.dart';
import 'package:lykora/data/tags.dart';

import 'support.dart';

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

  test('ein abgelehnter SOS blockiert den Abgleich nicht', () async {
    final server = FakeServer();
    final c = await newController(server);
    server.online = false;
    await c.sos(message: 'x');
    server
      ..online = true
      ..rejectSos = true;
    await c.start();
    await c.sync();
    expect(c.online, isTrue);
    expect(c.unsyncedCount, 0);
    expect(c.sosPending, isTrue);
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
    final g = await orga.post('/orgs/$orgId/games', {'content': gameJson});
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

