// SOS-Zuverlässigkeit: Der Alarm steht gespeichert in der Warteschlange, bevor er gesendet wird, und bleibt dort,
// bis der Server ihn bestätigt oder eindeutig ablehnt.

import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:lykora/data/api.dart';
import 'package:lykora/data/controller.dart';

import 'support.dart';

void main() {
  late int t;
  late FakeServer server;
  late GameController c;

  Future<void> setUpController({Duration? timeout}) async {
    t = DateTime.now().millisecondsSinceEpoch;
    server = FakeServer(now: () => DateTime.fromMillisecondsSinceEpoch(t));
    c = await newController(server, backgroundLoops: false, clock: () => t, timeout: timeout);
  }

  setUp(() => setUpController());

  group('bleibt in der Warteschlange', () {
    for (final (name, status, kind) in [
      ('Serverfehler 502', 502, ApiFailureKind.server),
      ('Serverfehler 503', 503, ApiFailureKind.server),
      ('Serverfehler 504', 504, ApiFailureKind.server),
      ('Anmeldung 401', 401, ApiFailureKind.unauthorized),
      ('zu viele Anfragen 429', 429, ApiFailureKind.rateLimited),
      ('Zeitüberschreitung 408', 408, ApiFailureKind.rateLimited),
      ('Ereignis unbekannt 404', 404, ApiFailureKind.notFound),
      ('Zugriff verweigert 403', 403, ApiFailureKind.rejected),
    ]) {
      test(name, () async {
        server.fail('/play/sos', status);
        final r = await c.sos(message: 'Knöchel');
        expect(r.queued, isTrue, reason: '$status darf den Alarm nicht verwerfen');
        expect(r.needsFallback, isTrue);
        expect(r.failure, kind);
        expect(r.reason, isNotEmpty);
        expect(c.sosPending, isTrue);
        expect(c.sosQueueLength, 1);
        expect(c.sosRejectedCount, 0);

        server.heal();
        t += 4000;
        await c.flushSos();
        expect(c.sosPending, isFalse);
        expect(server.sos.single['message'], 'Knöchel');
        expect(server.sos.single['deferred'], isTrue);
      });
    }

    test('Netz weg', () async {
      server.online = false;
      final r = await c.sos();
      expect(r.queued, isTrue);
      expect(r.failure, ApiFailureKind.offline);
      expect(c.sosPending, isTrue);
    });

    test('Zeitüberschreitung', () async {
      await setUpController(timeout: const Duration(milliseconds: 80));
      server.delayFor['/play/sos'] = const Duration(milliseconds: 400);
      final r = await c.sos();
      expect(r.queued, isTrue);
      expect(r.failure, ApiFailureKind.timeout);
    });
  });

  test('Anmeldeseite im WLAN: keine Ausnahme, der Alarm wartet', () async {
    server.captivePortal = true;
    final r = await c.sos(message: 'x');
    expect(r.queued, isTrue);
    expect(r.failure, ApiFailureKind.notLykora);
    expect(r.reason, contains('Lykora-Server'));
    expect(c.sosPending, isTrue);

    // Auch HTML hinter einem Proxy mit 502 ist nur ein Fehler auf Zeit.
    server.heal();
    server.htmlFor['/play/sos'] = 502;
    expect((await c.sos(message: 'y')).queued, isTrue);
    expect(c.sosQueueLength, 2);

    server.heal();
    await c.flushSos(force: true);
    expect(c.sosQueueLength, 0);
    expect(server.sos.map((x) => x['message']), ['x', 'y']);
  });

  test('zugestellt: kein Nachholen, keine Warteschlange', () async {
    final r = await c.sos(message: 'Hilfe');
    expect(r.delivered, isTrue);
    expect(r.reason, isNull);
    expect(r.needsFallback, isFalse);
    expect(c.sosPending, isFalse);
    expect(server.sos.single['deferred'], isNull, reason: 'beim ersten Versuch durchgekommen');
    expect(c.sosInfo(r.id)!.phase, SosPhase.delivered);
    expect(c.session!.lastSosId, r.id);
  });

  group('abgelehnt', () {
    for (final status in [400, 422]) {
      test('$status mit Fehlertext des Servers geht nicht mehr raus, bleibt aber sichtbar', () async {
        server.fail('/play/sos', status);
        final r = await c.sos();
        expect(r.rejected, isTrue);
        expect(r.queued, isFalse);
        expect(r.needsFallback, isTrue);
        expect(r.reason, 'Server kaputt');
        expect(c.sosPending, isFalse, reason: 'nichts wird nachgeholt');
        expect(c.sosRejectedCount, 1);
        expect(c.sosInfo(r.id)!.phase, SosPhase.rejected);
        expect(c.sosInfo(r.id)!.nextAttemptAt, isNull);

        final calls = server.calls.where((x) => x == 'POST /play/sos').length;
        t += 60000;
        await c.flushSos(force: true);
        await c.sync();
        expect(server.calls.where((x) => x == 'POST /play/sos').length, calls, reason: 'kein weiterer Versuch');
        expect(c.lastError, isNull, reason: 'der Abgleich selbst lief');
      });
    }

    test('bei einem nachgeholten Alarm blockiert die Ablehnung den Abgleich nicht', () async {
      server.online = false;
      await c.sos();
      server
        ..online = true
        ..rejectSos = true;
      await c.start();
      await c.sync();
      expect(c.online, isTrue);
      expect(c.unsyncedCount, 0);
      expect(c.sosRejectedCount, 1);
      expect(c.lastError, startsWith('SOS nicht angenommen'));
    });
  });

  test('ohne Sitzung: failed, ehrlich auf Anruf verweisen', () async {
    final loose = controllerFor(server, await Directory.systemTemp.createTemp('lykora-sos-'));
    final r = await loose.sos();
    expect(r.outcome, SosOutcome.failed);
    expect(r.needsFallback, isTrue);
    expect(r.reason, contains('anrufen'));
  });

  group('Warteschlange', () {
    test('steht auf der Platte, bevor gesendet wird', () async {
      server.delayFor['/play/sos'] = const Duration(milliseconds: 300);
      final pending = c.sos(message: 'mitten im Senden');
      await Future<void>.delayed(const Duration(milliseconds: 100));
      final file = File('${c.store.dir.path}/session.json');
      final saved = (jsonDecode(file.readAsStringSync()) as Map)['pendingSos'] as List;
      expect(saved.single['message'], 'mitten im Senden', reason: 'Absturz im Sendefenster darf den Alarm nicht kosten');
      expect((await pending).delivered, isTrue);
      expect(((jsonDecode(file.readAsStringSync()) as Map)['pendingSos'] as List), isEmpty);
    });

    test('übersteht einen Neustart und geht mit derselben Kennung raus', () async {
      server.online = false;
      final first = await c.sos(message: 'Neustart');
      server.online = true;

      final again = controllerFor(server, c.store.dir);
      await again.load();
      expect(again.sosPending, isTrue);
      expect(again.sosInfo(first.id)!.phase, SosPhase.queued);
      await again.flushSos(force: true);
      expect(again.sosPending, isFalse);
      expect(server.sos.single['id'], first.id);
    });

    test('Abstand der Versuche wächst von 3 s auf höchstens 30 s', () async {
      server.online = false;
      final r = await c.sos();
      final waits = <int>[];
      for (var i = 0; i < 7; i++) {
        final info = c.sosInfo(r.id)!;
        waits.add(info.nextAttemptAt!.millisecondsSinceEpoch - info.lastAttemptAt!.millisecondsSinceEpoch);
        t = info.nextAttemptAt!.millisecondsSinceEpoch;
        await c.flushSos();
      }
      expect(waits, [3000, 6000, 12000, 24000, 30000, 30000, 30000]);
      expect(c.sosInfo(r.id)!.attempts, 8);
    });

    test('vor Ablauf der Wartezeit kein Versuch, mit force sofort', () async {
      server.fail('/play/sos', 503);
      await c.sos();
      int calls() => server.calls.where((x) => x == 'POST /play/sos').length;
      expect(calls(), 1);
      t += 1000;
      await c.flushSos();
      expect(calls(), 1, reason: 'erst nach 3 s');
      await c.flushSos(force: true);
      expect(calls(), 2, reason: 'Knopf „Nochmal senden“');
      t += 7000;
      await c.flushSos();
      expect(calls(), 3);
    });

    test('der Abgleich versucht es sofort, auch vor Ablauf der Wartezeit', () async {
      server.fail('/play/sos', 503, times: 1);
      await c.sos();
      await c.sync();
      expect(c.sosPending, isFalse);
      expect(server.sos, hasLength(1));
    });

    test('Stand je Alarm: Versuche, letzter und nächster Versuch, Grund', () async {
      server.fail('/play/sos', 503);
      final start = t;
      final r = await c.sos();
      final info = c.sosInfo(r.id)!;
      expect(info.phase, SosPhase.queued);
      expect(info.attempts, 1);
      expect(info.lastAttemptAt!.millisecondsSinceEpoch, start);
      expect(info.nextAttemptAt!.millisecondsSinceEpoch, start + 3000);
      expect(info.reason, contains('503'));
      expect(c.sosLastAttemptAt!.millisecondsSinceEpoch, start);
      expect(c.sosInfo(null), isNull);
    });

    test('zwei Alarme: beide kommen genau einmal an, die Reihenfolge bleibt', () async {
      server.online = false;
      await c.sos(message: 'eins');
      await c.sos(message: 'zwei');
      expect(c.sosQueueLength, 2);
      server.online = true;
      await c.flushSos(force: true);
      await c.flushSos(force: true);
      expect(server.sos.map((x) => x['message']), ['eins', 'zwei']);
      expect(server.sos.map((x) => x['id']).toSet(), hasLength(2));
    });

    test('gleichzeitige Versuche senden denselben Alarm nur einmal', () async {
      server.delayFor['/play/sos'] = const Duration(milliseconds: 100);
      server.fail('/play/sos', 503, times: 1);
      await c.sos();
      await Future.wait([c.flushSos(force: true), c.flushSos(force: true), c.sync()]);
      expect(server.sos, hasLength(1));
    });

    test('der Server hört nichts von den Feldern, die nur auf dem Handy stehen', () async {
      server.online = false;
      await c.sos(message: 'Bein');
      server.online = true;
      await c.flushSos(force: true);
      expect(server.sos.single.keys.toSet(), {'id', 'time', 'message', 'deferred'});
    });
  });

  test('Oberflächentext „wird nachgeholt“ ist nur bei echter Warteschlange möglich', () async {
    // Die Seite zeigt den Nachhol-Satz nur bei queued; jeder andere Ausgang hat eine eigene Aussage.
    for (final (status, expected) in [(503, SosOutcome.queued), (400, SosOutcome.rejected), (200, SosOutcome.delivered)]) {
      await setUpController();
      if (status != 200) server.fail('/play/sos', status);
      final r = await c.sos();
      expect(r.outcome, expected, reason: 'Status $status');
      expect(r.queued, c.sosPending, reason: 'queued heißt: wirklich gespeichert');
    }
  });
}
