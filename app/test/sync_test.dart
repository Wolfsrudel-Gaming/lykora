// Abgleich im schwachen Netz: Nachrichten und Fotos gehen bei Serverfehlern nicht verloren, Fehler bleiben sichtbar,
// große Rückstände gehen in Stücken, die Uhr ist gegen lange Antworten geschützt.

import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:lykora/data/api.dart';
import 'package:lykora/data/controller.dart';

import 'support.dart';

void main() {
  late int t;
  late FakeServer server;
  late GameController c;

  DateTime wall(int ms) => DateTime.fromMillisecondsSinceEpoch(ms);

  Future<void> setUpController({Map<String, dynamic>? game}) async {
    t = DateTime.now().millisecondsSinceEpoch;
    server = FakeServer(game: game, now: () => wall(t));
    c = await newController(server, backgroundLoops: false, clock: () => t);
  }

  setUp(() => setUpController());

  Map<String, dynamic> editedGame(void Function(Map<String, dynamic> game) edit) {
    final g = jsonDecode(jsonEncode(gameJson)) as Map<String, dynamic>;
    edit(g);
    return g;
  }

  Map<String, dynamic> station(Map<String, dynamic> g, String id) => (g['stations'] as List).cast<Map<String, dynamic>>().firstWhere((s) => s['id'] == id);

  group('Nachrichten', () {
    for (final (name, status) in [('Serverfehler 503', 503), ('Anmeldung 401', 401), ('zu viele Anfragen 429', 429), ('Zeitüberschreitung 408', 408)]) {
      test('$name lässt die Nachricht warten, der Fehler bleibt stehen', () async {
        server.fail('/play/messages', status);
        await c.sendMessage('Uns ist mulmig', kind: 'predefined');
        final m = c.session!.messages.single;
        expect(m.pending, isTrue);
        expect(m.failed, isFalse);
        expect(server.messages, isEmpty);
        expect(c.lastError, startsWith('Nachricht noch nicht gesendet'));

        // Der Abgleich selbst gelingt, die Meldung bleibt trotzdem stehen.
        await c.sync();
        expect(m.pending, isTrue);
        expect(c.lastError, startsWith('Nachricht noch nicht gesendet'), reason: 'nicht gleich mit null überschrieben');
        expect(c.unsyncedCount, 0);

        server.heal();
        await c.sync();
        expect(m.pending, isFalse);
        expect(server.messages.single['body'], 'Uns ist mulmig');
        expect(c.lastError, isNull);
      });
    }

    test('Anmeldeseite im WLAN: die Nachricht wartet', () async {
      server.htmlFor['/play/messages'] = 200;
      await c.sendMessage('Hallo');
      expect(c.session!.messages.single.pending, isTrue);
      expect(c.lastError, contains('Lykora-Server'));
    });

    test('Ablehnung (400): als nicht angenommen markiert, nicht noch einmal gesendet', () async {
      server.fail('/play/messages', 400);
      await c.sendMessage('zu lang');
      final m = c.session!.messages.single;
      expect(m.pending, isFalse);
      expect(m.failed, isTrue);
      expect(c.lastError, startsWith('Nachricht nicht angenommen'));
      server.heal();
      await c.sync();
      expect(server.messages, isEmpty);
      expect(c.lastError, isNull);

      // Die Markierung überlebt einen Neustart.
      await Future<void>.delayed(const Duration(milliseconds: 30));
      final again = controllerFor(server, c.store.dir);
      await again.load();
      expect(again.session!.messages.single.failed, isTrue);
    });

    test('die Reihenfolge bleibt: scheitert die erste, wartet die zweite mit', () async {
      server.fail('/play/messages', 503);
      await c.sendMessage('eins');
      await c.sendMessage('zwei');
      expect(server.messages, isEmpty);
      expect(server.calls.where((x) => x == 'POST /play/messages'), hasLength(2), reason: 'je Aufruf ein Versuch, nicht jede Nachricht einzeln');
      server.heal();
      await c.sync();
      expect(server.messages.map((m) => m['body']), ['eins', 'zwei']);
    });
  });

  group('Fotos', () {
    Future<String> photo() async {
      await c.start();
      return c.addUpload(Uint8List.fromList([1, 2, 3]), 'image/jpeg');
    }

    test('Serverfehler 503: Datei und Eintrag bleiben, der Fehler bleibt sichtbar', () async {
      server.fail('/play/uploads', 503);
      final id = await photo();
      await c.sync();
      expect(c.session!.pendingUploads, hasLength(1));
      expect(File('${c.store.uploadsDir.path}/$id').existsSync(), isTrue);
      expect(c.lastError, startsWith('Foto noch nicht gesendet'));
      expect(c.unsyncedCount, 0, reason: 'Aktionen wurden trotzdem abgeglichen');

      server.heal();
      await c.sync();
      expect(c.session!.pendingUploads, isEmpty);
      expect(File('${c.store.uploadsDir.path}/$id').existsSync(), isFalse);
      expect(server.uploads.single, {'id': id, 'contentType': 'image/jpeg', 'length': 3});
      expect(c.lastError, isNull);
    });

    test('ohne Netz bleibt das Foto', () async {
      await photo();
      server.online = false;
      await c.sync();
      expect(c.session!.pendingUploads, hasLength(1));
      expect(c.online, isFalse);
    });

    test('Ablehnung (413): verworfen, und das Team erfährt es im Funkprotokoll', () async {
      server.fail('/play/uploads', 413);
      final id = await photo();
      await c.sync();
      expect(c.session!.pendingUploads, isEmpty);
      expect(File('${c.store.uploadsDir.path}/$id').existsSync(), isFalse);
      expect(c.lastError, startsWith('Foto nicht angenommen'));
      final notice = c.session!.messages.last;
      expect(notice.kind, 'story');
      expect(notice.body, startsWith('Ein Foto wurde nicht angenommen'));

      server.heal();
      await c.sync();
      expect(c.lastError, isNull);
    });

    test('ein Foto, das nicht mehr auf dem Gerät liegt, blockiert nichts', () async {
      final id = await photo();
      File('${c.store.uploadsDir.path}/$id').deleteSync();
      await c.sync();
      expect(c.session!.pendingUploads, isEmpty);
    });
  });

  group('Abgleich', () {
    test('Serverfehler 503 beim Abgleich: offline, mit verständlichem Text', () async {
      server.fail('/play/sync', 503);
      await c.sync();
      expect(c.online, isFalse);
      expect(c.lastFailure, ApiFailureKind.server);
      expect(c.lastError, 'Der Server hat gerade ein Problem (Fehler 503).');
    });

    test('Anmeldeseite beim Abgleich: kein FormatException-Text', () async {
      server.captivePortal = true;
      await c.sync();
      expect(c.online, isFalse);
      expect(c.lastFailure, ApiFailureKind.notLykora);
      expect(c.lastError, isNot(contains('Exception')));
      expect(c.lastError, contains('Lykora-Server'));
    });

    test('401 beim Abgleich: das Team erfährt, dass das Handy nicht mehr angemeldet ist', () async {
      server.fail('/play/sync', 401);
      await c.sync();
      expect(c.lastFailure, ApiFailureKind.unauthorized);
      expect(c.lastError, contains('nicht mehr angemeldet'));
    });

    test('nach Erfolg sind Fehler und Art weg', () async {
      server.fail('/play/sync', 503);
      await c.sync();
      server.heal();
      await c.sync();
      expect(c.lastError, isNull);
      expect(c.lastFailure, isNull);
      expect(c.online, isTrue);
    });

    test('große Rückstände gehen in Stücken zu 500 Positionen', () async {
      c.session!.pendingPositions = [
        for (var i = 0; i < 1200; i++) {'lat': 50.8, 'lon': 7.1, 'accuracy': 5.0, 'time': wall(t + i).toUtc().toIso8601String()},
      ];
      await c.sync();
      await c.sync();
      await c.sync();
      expect(server.syncs.map((s) => (s['positions'] as List).length), [500, 500, 200]);
      expect(c.session!.pendingPositions, isEmpty);
    });

    test('Positionen bleiben, wenn der Abgleich scheitert', () async {
      c.session!.pendingPositions = [
        {'lat': 50.8, 'lon': 7.1, 'accuracy': 5.0, 'time': wall(t).toUtc().toIso8601String()},
      ];
      server.fail('/play/sync', 503);
      await c.sync();
      expect(c.session!.pendingPositions, hasLength(1));
    });
  });

  group('Uhr des Servers', () {
    test('Versatz aus der Mitte von Senden und Empfang', () async {
      await setUpController();
      server = FakeServer(now: () => wall(t + 7200000));
      c = await newController(server, backgroundLoops: false, clock: () => t);
      expect(c.session!.clockOffsetMs, 7200000);
      expect(c.now(), t + 7200000);
    });

    test('lange Antworten verstellen die Uhr nicht', () async {
      final before = c.session!.clockOffsetMs;
      server.holdSync = Completer<void>();
      final sync = c.sync();
      await Future<void>.delayed(const Duration(milliseconds: 30));
      t += 8000;
      server.holdSync!.complete();
      await sync;
      expect(c.session!.clockOffsetMs, before, reason: '8 s Antwortzeit sagen nichts über die Uhr');
    });
  });

  group('Takt', () {
    test('clock zeigt die Spielzeit und tick meldet nur echte Änderungen', () async {
      await c.start();
      var notified = 0;
      c.addListener(() => notified++);
      t += 1000;
      c.tick();
      expect(c.clock.value, c.now());
      t += 1000;
      c.tick();
      expect(notified, 0, reason: 'sekündlich ändert sich nichts, was der Controller melden müsste');

      // Lebenszeichen fällig: Das muss die Sicherheitsschicht erfahren, auch ohne Abgleich.
      t += 901 * 1000;
      c.tick();
      expect(c.heartbeatDue, isTrue);
      expect(notified, 1);
      c.tick();
      expect(notified, 1);
    });

    test('tick meldet, wenn die Position veraltet', () async {
      await c.start();
      await c.onPosition(50.8155, 7.155, 8, at: wall(t));
      var notified = 0;
      c.addListener(() => notified++);
      c.tick();
      final base = notified;
      t += 21000;
      c.tick();
      expect(notified, base + 1);
    });
  });

  group('Ziel', () {
    test('Station mit Prüfung durch die Spielleitung hält den Peiler nicht fest', () async {
      await setUpController(
        game: editedGame((g) {
          final s = station(g, 'versteck');
          s['visibility'] = 'visible';
          (s['task'] as Map)['review'] = 'manual';
        }),
      );
      await c.start();
      await c.trigger('briefing', 'qr');
      await c.answer('briefing', {
        'choice': [0],
      });
      await c.trigger('versteck', 'qr');
      await c.answer('versteck', {'upload': 'foto'});
      expect(c.state.pendingReviews, ['versteck']);
      expect(c.nextTarget!.id, isNot('versteck'));
      expect(c.nextTarget!.id, 'baum');
    });

    test('bleibt nur die Station mit Prüfung übrig, zeigt der Peiler weiter dorthin', () async {
      await setUpController(
        game: editedGame((g) {
          final s = station(g, 'versteck');
          s['visibility'] = 'visible';
          (s['task'] as Map)['review'] = 'manual';
          g['stations'] = [s];
        }),
      );
      await c.start();
      await c.trigger('versteck', 'qr');
      await c.answer('versteck', {'upload': 'foto'});
      expect(c.state.pendingReviews, ['versteck']);
      expect(c.nextTarget!.id, 'versteck', reason: 'sonst hieße es fälschlich „Geschafft“');
    });

    test('manuell getippter Code: Groß- und Kleinschreibung und Leerzeichen zählen nicht', () async {
      await setUpController(
        game: editedGame((g) {
          final triggers = (station(g, 'baum')['triggers'] as List).cast<Map<String, dynamic>>();
          triggers.firstWhere((x) => x['type'] == 'manual')['code'] = 'Eule7';
        }),
      );
      await c.start();
      expect(await c.triggerByCode('manual', 'eule7'), isNotNull);
      expect(await c.triggerByCode('manual', '  EULE7 '), isNotNull);
      expect(await c.triggerByCode('manual', 'eule'), isNull);
      expect(await c.triggerByCode('manual', ''), isNull);
    });
  });
}
