// Beitritt und Medien: Die Sitzung steht gespeichert, sobald der Server das Team angelegt hat; abgebrochene Beitritte
// setzen fort statt ein zweites Team anzulegen; fehlende Medien werden nachgeladen.

import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:lykora/data/api.dart';
import 'package:lykora/data/controller.dart';
import 'package:lykora/data/session.dart';

import 'support.dart';

const _address = 'https://example.org/lykora';

void main() {
  late FakeServer server;
  late Directory dir;
  late GameController c;

  Future<void> join(GameController c, {bool awaitMedia = true, String name = 'Füchse'}) =>
      c.join(server: _address, code: 'K7M2QX', teamName: name, awaitMedia: awaitMedia);

  Future<ApiException> joinFails(GameController c) async {
    try {
      await join(c);
    } on ApiException catch (e) {
      return e;
    }
    fail('der Beitritt hätte scheitern müssen');
  }

  File sessionFile() => File('${dir.path}/session.json');

  setUp(() async {
    server = FakeServer();
    dir = await Directory.systemTemp.createTemp('lykora-join-');
    c = controllerFor(server, dir);
  });

  group('Beitritt', () {
    test('die Sitzung steht auf der Platte, bevor das Spielpaket kommt', () async {
      server.fail('/play/game', 503);
      final e = await joinFails(c);
      expect(e.kind, ApiFailureKind.server);
      expect(c.hasSession, isTrue);
      expect(c.hasGame, isFalse);
      expect(c.needsPackage, isTrue);
      expect(sessionFile().existsSync(), isTrue, reason: 'sonst ist das Team nach einem Prozessende verwaist');
      expect(sessionFile().readAsStringSync(), contains('"token":"tok"'));
    });

    test('Proxy-Fehler (502 mit HTML) beim Spielpaket: dasselbe', () async {
      server.htmlFor['/play/game'] = 502;
      final e = await joinFails(c);
      expect(e.kind, ApiFailureKind.server);
      expect(sessionFile().existsSync(), isTrue);
      expect(server.joinCalls, 1);
    });

    test('nach Neustart und zweitem Versuch: kein zweites Team', () async {
      server
        ..uniqueTeamNames = true
        ..fail('/play/game', 503);
      await joinFails(c);

      final restarted = controllerFor(server, dir);
      await restarted.load();
      expect(restarted.needsPackage, isTrue, reason: 'die Oberfläche führt direkt zum Packen');
      server.heal();
      await join(restarted);
      expect(server.joinCalls, 1, reason: 'der Server kennt das Team schon');
      expect(restarted.hasGame, isTrue);
      expect(restarted.needsPackage, isFalse);
      expect(restarted.session!.deviceCode, 'AB3D');
    });

    test('zweiter Versuch im selben Lauf legt kein zweites Team an', () async {
      server
        ..uniqueTeamNames = true
        ..fail('/play/game', 503, times: 1);
      await joinFails(c);
      await join(c);
      expect(server.joinCalls, 1);
      expect(server.teamNames, ['Füchse']);
      expect(c.hasGame, isTrue);
    });

    test('anderer Event-Code: neues Team, nichts wird wiederverwendet', () async {
      server.fail('/play/game', 503, times: 1);
      await joinFails(c);
      await c.join(server: _address, code: 'ZZZZZZ', teamName: 'Wölfe');
      expect(server.joinCalls, 2);
      expect(c.session!.eventCode, 'ZZZZZZ');
    });

    test('mit Spiel ist ein neuer Beitritt ein neuer Beitritt', () async {
      await join(c);
      await join(c, name: 'Wölfe');
      expect(server.joinCalls, 2);
    });

    test('bei Erfolg steht alles auf der Platte', () async {
      await join(c);
      final saved = await c.store.load();
      expect(saved!.gameJson, isNotNull);
      expect(saved.team['name'], 'Füchse');
      expect(saved.token, 'tok');
    });
  });

  group('Fehler beim Beitritt sind getypt', () {
    test('Anmeldeseite (200 mit HTML)', () async {
      server.captivePortal = true;
      final e = await joinFails(c);
      expect(e.kind, ApiFailureKind.notLykora);
      expect(e.offline, isFalse, reason: 'liegt nicht am fehlenden Netz');
      expect(c.hasSession, isFalse);
      expect(sessionFile().existsSync(), isFalse);
    });

    test('falsche Adresse (404 mit HTML)', () async {
      server.htmlFor['/join'] = 404;
      expect((await joinFails(c)).kind, ApiFailureKind.notLykora);
    });

    test('Adresse ohne Schema', () async {
      final e = await failure(c.join(server: 'example.org/lykora', code: 'K7M2QX', teamName: 'Füchse'));
      expect(e.kind, ApiFailureKind.badAddress);
      expect(e.offline, isFalse);
      expect(server.calls, isEmpty);
    });

    test('Event-Code unbekannt', () async {
      server.fail('/join', 404);
      final e = await joinFails(c);
      expect(e.kind, ApiFailureKind.notFound);
      expect(e.retryable, isFalse);
    });

    test('Teamname vergeben', () async {
      server.uniqueTeamNames = true;
      await join(c);
      final e = await joinFails(controllerFor(server, await Directory.systemTemp.createTemp('lykora-join-')));
      expect(e.kind, ApiFailureKind.rejected);
      expect(e.status, 409);
      expect(e.message, 'Diesen Teamnamen gibt es schon');
    });

    test('Server ohne Netz: offline', () async {
      server.online = false;
      final e = await joinFails(c);
      expect(e.kind, ApiFailureKind.offline);
      expect(e.offline, isTrue);
    });

    test('gültiges JSON, aber kein Lykora-Server', () async {
      final odd = GameController(
        store: SessionStore(dir),
        apiFactory: (s, t) => Api(
          s,
          token: t,
          client: MockClient((_) async => http.Response('{"ok":true}', 200, headers: {'content-type': 'application/json'})),
        ),
        backgroundLoops: false,
      );
      expect((await joinFails(odd)).kind, ApiFailureKind.notLykora);
      expect(odd.hasSession, isFalse);
    });

    test('Spielpaket ist kein Spiel', () async {
      final odd = GameController(
        store: SessionStore(dir),
        apiFactory: (s, t) => Api(
          s,
          token: t,
          client: MockClient((req) async {
            final body = req.url.path.endsWith('/join') ? '{"token":"t","eventId":"e","team":{"id":"1"}}' : '{"hello":1}';
            return http.Response(body, 200, headers: {'content-type': 'application/json'});
          }),
        ),
        backgroundLoops: false,
      );
      final e = await joinFails(odd);
      expect(e.kind, ApiFailureKind.notLykora);
      expect(odd.needsPackage, isTrue, reason: 'das Team steht; das Paket kann nachgeholt werden');
    });
  });

  group('Medien', () {
    test('mediaProgress zählt Dateien und Bytes bis zum Schluss', () async {
      final seen = <MediaProgress>[];
      c.mediaProgress.addListener(() => seen.add(c.mediaProgress.value));
      await join(c);
      expect(seen, isNotEmpty);
      final dones = seen.map((p) => p.done).toList();
      expect(dones, orderedEquals([...dones]..sort()), reason: 'es geht nur vorwärts');
      expect(seen.any((p) => p.running), isTrue);
      expect(c.mediaProgress.value.total, 9);
      expect(c.mediaProgress.value.done, 9);
      expect(c.mediaProgress.value.bytes, 9 * FakeServer.mediaBytes.length);
      expect(c.mediaProgress.value.running, isFalse);
      expect(c.mediaProgress.value.complete, isTrue);
      expect(c.mediaProgress.value.fraction, 1);
      expect(c.missingMedia, 0);
    });

    test('ohne awaitMedia kehrt der Beitritt nach dem Spielpaket zurück, die Medien laden weiter', () async {
      await join(c, awaitMedia: false);
      expect(c.hasGame, isTrue);
      expect(sessionFile().existsSync(), isTrue);
      expect(c.mediaProgress.value.total, 9);
      await c.waitForMedia();
      expect(c.mediaProgress.value.complete, isTrue);
      expect(server.mediaRequests, hasLength(9));
    });

    test('fehlende Medien werden gezählt und per Knopf nachgeladen', () async {
      server.missingMedia.add('/lykora/media/lib/donner.ogg');
      await join(c);
      expect(c.missingMedia, 1);
      expect(c.mediaProgress.value.complete, isFalse);
      expect(c.mediaFile('donner'), isNull);

      server.mediaRequests.clear();
      server.missingMedia.clear();
      await c.retryMedia();
      expect(server.mediaRequests, ['/lykora/media/lib/donner.ogg'], reason: 'nur, was fehlt');
      expect(c.missingMedia, 0);
      expect(c.mediaFile('donner'), isNotNull);
    });

    test('teilweise Fehlschläge: ein 503 bei einer Datei hindert die anderen nicht', () async {
      server.fail('/lykora/media/lib/eule.ogg', 503);
      await join(c);
      expect(c.missingMedia, 1);
      expect(c.mediaFile('wind'), isNotNull);
      expect(c.mediaFile('donner'), isNotNull);
    });

    test('der nächste erfolgreiche Abgleich holt Fehlendes nach', () async {
      server.missingMedia.add('/lykora/media/lib/donner.ogg');
      await join(c);
      expect(c.missingMedia, 1);
      server.missingMedia.clear();
      await c.sync();
      await c.waitForMedia();
      expect(c.missingMedia, 0, reason: 'Netz ist da (wieder): Medien kommen nach');
    });

    test('Rückkehr in die App holt Fehlendes nach', () async {
      server.missingMedia.add('/lykora/media/lib/donner.ogg');
      await join(c);
      server.missingMedia.clear();
      c.onAppResumed();
      await c.waitForMedia();
      expect(c.missingMedia, 0);
    });

    test('nach drei Fehlschlägen in Folge ruht der Lauf, der nächste versucht es wieder', () async {
      await join(c);
      for (final f in c.store.mediaDir.listSync()) {
        f.deleteSync();
      }
      for (final path in server.mediaRequests.toSet()) {
        server.fail(path, 503);
      }
      server.calls.clear();
      await c.retryMedia();
      expect(server.calls.where((x) => x.startsWith('GET /lykora/media/')), hasLength(3), reason: 'wohl kein Netz: nicht alle neun durchprobieren');
      expect(c.missingMedia, 9);
      server.heal();
      await c.retryMedia();
      expect(c.missingMedia, 0);
    });

    test('mehrfaches Anstoßen startet keinen zweiten Lauf', () async {
      server.missingMedia.add('/lykora/media/lib/donner.ogg');
      await join(c);
      server.missingMedia.clear();
      server.mediaRequests.clear();
      await Future.wait([c.retryMedia(), c.retryMedia(), c.retryMedia()]);
      expect(server.mediaRequests, ['/lykora/media/lib/donner.ogg']);
    });

    test('nach dem Verlassen legt ein laufender Lauf nichts mehr ab', () async {
      await join(c, awaitMedia: false);
      await c.leave();
      await c.waitForMedia();
      await Future<void>.delayed(const Duration(milliseconds: 30));
      expect(dir.listSync().where((f) => f.path.endsWith('media')), isEmpty);
    });
  });
}

Future<ApiException> failure(Future<Object?> call) async {
  try {
    await call;
  } on ApiException catch (e) {
    return e;
  }
  fail('es hätte eine ApiException kommen müssen');
}
