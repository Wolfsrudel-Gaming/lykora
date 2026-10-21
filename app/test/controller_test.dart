// Tests der Spielsteuerung. Ohne Netz läuft alles gegen einen nachgebauten Server;
// mit LYKORA_TEST_SERVER (und LYKORA_TEST_ADMIN=email:passwort) zusätzlich gegen einen echten.

import 'dart:async';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:lykora/data/api.dart';
import 'package:lykora/data/controller.dart';
import 'package:lykora/data/session.dart';

import 'support.dart';

void main() {
  test('erkennt Einstiegs-QR, Links und reine Codes', () {
    expect(parseJoinCode('lykora://join?server=https%3A%2F%2Fexample.org%2Flykora&code=k7m2qx'), (server: 'https://example.org/lykora', code: 'K7M2QX'));
    expect(parseJoinCode('https://example.org/lykora/join/K7M2QX'), (server: 'https://example.org/lykora', code: 'K7M2QX'));
    expect(parseJoinCode('k7m2qx'), (server: null, code: 'K7M2QX'));
    expect(parseJoinCode('kein code!'), isNull);
  });

  test('spielt offline weiter und holt Aktionen und SOS nach', () async {
    final server = FakeServer();
    final c = await newController(server);
    expect(c.hasGame, isTrue);
    expect(c.eventRunning, isTrue);

    await c.start();
    expect((await c.triggerByCode('qr', 'LYK-BRIEFING'))!.ok, isTrue);
    final r = await c.answer('briefing', {
      'choice': [0],
    });
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
    final again = GameController(
      store: c.store,
      apiFactory: (s, t) => Api(s, token: t, client: server.client()),
    );
    await again.load();
    expect(again.state.triggered, ['briefing']);
    expect(again.session!.teamName, 'Füchse');
  });

  test('lädt die Medien des Spiels über die Server-Anbindung', () async {
    final server = FakeServer()..missingMedia.add('/lykora/media/lib/donner.ogg');
    final c = await newController(server);
    expect(server.mediaRequests, hasLength(9));
    expect(server.mediaRequests, contains('/lykora/media/lib/wind.ogg'));
    expect(c.mediaFile('wind')!.readAsBytesSync(), FakeServer.mediaBytes);
    expect(c.mediaFile('donner'), isNull, reason: 'fehlende Medien verhindern das Spiel nicht');
    expect(c.mediaFile(null), isNull);
    expect(c.store.mediaDir.listSync().where((f) => f.path.endsWith('.part')), isEmpty, reason: 'keine halben Dateien');

    // Beim nächsten Laden nur, was noch fehlt.
    server
      ..mediaRequests.clear()
      ..missingMedia.clear();
    await c.downloadGame();
    expect(server.mediaRequests, ['/lykora/media/lib/donner.ogg']);
    expect(c.mediaFile('donner'), isNotNull);

    // Fehlt eine Datei des Spiels, holt ein Cue sie über die Quelle aus dem Spiel nach, auch ohne src im Cue.
    await File('${c.store.mediaDir.path}/eule').delete();
    server.mediaRequests.clear();
    expect((await c.cueFile(const Cue(audio: 'eule')))!.path, endsWith('/eule'));
    expect(server.mediaRequests, ['/lykora/media/lib/eule.ogg']);

    // Eine Anmeldeseite im WLAN liefert HTML statt Klang: nichts speichern.
    await File('${c.store.mediaDir.path}/eule').delete();
    server.captivePortal = true;
    expect(await c.cueFile(const Cue(audio: 'eule')), isNull);
    expect(c.mediaFile('eule'), isNull);
    expect(c.store.mediaDir.listSync().where((f) => f.path.endsWith('.part')), isEmpty);
    server.captivePortal = false;

    // Ohne Netz bleibt es beim Stand.
    server.online = false;
    expect(await c.cueFile(const Cue(audio: 'eule', src: 'media/lib/eule.ogg')), isNull);
  });

  test('verlassen während eines Abgleichs legt keine Daten wieder an', () async {
    final server = FakeServer();
    final c = await newController(server);
    server.holdSync = Completer<void>();
    final sync = c.sync();
    await Future<void>.delayed(const Duration(milliseconds: 50));
    final left = c.leave();
    server.holdSync!.complete();
    await sync;
    await left;
    await Future<void>.delayed(const Duration(milliseconds: 50));
    final again = GameController(
      store: c.store,
      apiFactory: (s, t) => Api(s, token: t, client: server.client()),
    );
    await again.load();
    expect(again.hasSession, isFalse);
  });

  test('Medienadressen relativ zum Server oder als URL', () {
    final api = Api('https://example.org/lykora/');
    expect(api.mediaUri('media/lib/eule.ogg').toString(), 'https://example.org/lykora/media/lib/eule.ogg');
    expect(api.mediaUri('/media/abc.mp3').toString(), 'https://example.org/lykora/media/abc.mp3');
    expect(api.mediaUri('https://cdn.example.org/x.ogg').toString(), 'https://cdn.example.org/x.ogg');
  });

  test('merkt sich, ob die Spielleitung den SOS gelesen hat', () async {
    final server = FakeServer();
    final c = await newController(server);
    expect(await c.sos(message: 'Knöchel'), isTrue);
    final id = c.session!.lastSosId!;
    expect(c.sosStatus(id), isNull, reason: 'noch kein Abgleich');
    await c.sync();
    expect(c.sosStatus(id)!['acknowledgedAt'], isNull);
    server.sosAck[id] = {'acknowledgedAt': DateTime.now().toUtc().toIso8601String(), 'acknowledgedBy': 'Anna'};
    await c.sync();
    expect(c.sosStatus(id)!['acknowledgedBy'], 'Anna');
    expect(c.sosStatus('andere'), isNull);
    expect(c.sosStatus(null), isNull);

    await Future<void>.delayed(const Duration(milliseconds: 50));
    final again = GameController(
      store: c.store,
      apiFactory: (s, t) => Api(s, token: t, client: server.client()),
    );
    await again.load();
    expect(again.session!.lastSosId, id);
    expect(again.sosStatus(id)!['acknowledgedBy'], 'Anna');
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
    await c.answer('briefing', {
      'choice': [0],
    });
    await c.sync();
    expect(c.online, isTrue, reason: c.lastError);
    expect(c.unsyncedCount, 0);
    expect(c.session!.serverState!['solved'], ['briefing']);
    expect(c.session!.serverState!['points'], c.state.points);

    // Eingriff der Spielleitung kommt in der App an
    await orga.post('/events/${ev['id']}/teams/${c.session!.teamId}/actions', {
      'type': 'staff_points',
      'payload': {'amount': 7},
    });
    await orga.post('/events/${ev['id']}/messages', {'teamId': c.session!.teamId, 'body': 'Weiter so!'});
    await c.sync();
    expect(c.state.points, 57);
    expect(c.session!.messages.map((m) => m.body), contains('Weiter so!'));
    expect(await c.sos(message: 'Test'), isTrue);
  }, skip: live == null ? 'LYKORA_TEST_SERVER nicht gesetzt' : false);

  test('Klänge, Cues, Anstupsen und SOS-Quittung mit echtem Server', () async {
    final admin = Platform.environment['LYKORA_TEST_ADMIN']!.split(':');
    final orga = Api(live!);
    final login = await orga.post('/auth/login', {'email': admin[0], 'password': admin[1]});
    orga.token = login['token'] as String;
    final me = await orga.get('/me');
    final orgId = ((me['orgs'] as List).first as Map)['id'];
    final g = await orga.post('/orgs/$orgId/games', {'content': gameJson});
    final ev = await orga.post('/orgs/$orgId/events', {'gameId': g['id'], 'name': 'Klang-Test'});
    final eventId = ev['id'];
    await orga.post('/events/$eventId/start', {});

    final c = GameController(store: SessionStore(await Directory.systemTemp.createTemp('lykora-klang-')));
    await c.join(server: live, code: (ev['join'] as Map)['code'] as String, teamName: 'Klang-${DateTime.now().millisecondsSinceEpoch}', supervisorPin: ev['supervisorPin'] as String);

    // Die Bibliotheksklänge des Spiels liegen nach dem Beitritt offline bereit.
    Future<String> magic(File f) async => String.fromCharCodes(await f.openRead(0, 4).first);
    for (final id in ['wind', 'sturm', 'wald-nacht', 'eule', 'funk-knacken', 'kiste-auf']) {
      final f = c.mediaFile(id);
      expect(f, isNotNull, reason: id);
      expect(await magic(f!), 'OggS', reason: id);
    }

    await c.start();
    c.startLoops();
    await Future<void>.delayed(const Duration(seconds: 3));
    final teamId = c.session!.teamId;

    // Ein Klang aus der Bibliothek, der nicht im Spiel steckt: Das Anstupsen bringt ihn vor dem nächsten regulären Abgleich.
    final cue = c.incoming.firstWhere((m) => m.kind == 'cue').timeout(const Duration(seconds: 10));
    await orga.post('/events/$eventId/cues', {'teamId': teamId, 'audio': 'lib:wolf-heulen', 'volume': 0.5, 'text': 'Hört ihr das?'});
    final m = await cue;
    expect(m.cue!.audio, 'lib:wolf-heulen');
    expect(m.cue!.text, 'Hört ihr das?');
    final file = await c.cueFile(m.cue!);
    expect(file, isNotNull);
    expect(await magic(file!), 'OggS');

    // Die Spielleitung bestätigt den SOS; das Handy erfährt es per Anstupsen.
    expect(await c.sos(message: 'Klang-Test'), isTrue);
    final list = await orga.get('/events/$eventId/sos');
    final sosId = ((list['items'] as List).first as Map)['id'];
    await orga.post('/events/$eventId/sos/$sosId/ack', {});
    final until = DateTime.now().add(const Duration(seconds: 10));
    while (!(c.session!.sos.any((x) => x['acknowledgedAt'] != null)) && DateTime.now().isBefore(until)) {
      await Future<void>.delayed(const Duration(milliseconds: 200));
    }
    expect(c.session!.sos.any((x) => x['acknowledgedAt'] != null), isTrue);
    c.stopLoops();
  }, skip: live == null ? 'LYKORA_TEST_SERVER nicht gesetzt' : false);
}
