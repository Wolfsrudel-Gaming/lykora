// Antworten und Zeitlimits der Server-Anbindung: Fehlerarten, Anmeldeseite, Fortschritt statt Gesamtdauer.

import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:lykora/data/api.dart';

const _server = 'https://example.org/lykora';
const _json = {'content-type': 'application/json'};
const _html = {'content-type': 'text/html; charset=utf-8'};

Api api(http.Response Function(http.Request) respond, {Duration? connect, Duration? idle}) => Api(
  _server,
  token: 'tok',
  client: MockClient((req) async => respond(req)),
  connectTimeout: connect ?? const Duration(seconds: 15),
  idleTimeout: idle ?? const Duration(seconds: 20),
);

Future<ApiException> failure(Future<Object?> call) async {
  try {
    await call;
  } on ApiException catch (e) {
    return e;
  }
  fail('es hätte eine ApiException kommen müssen');
}

void main() {
  group('Fehlerarten', () {
    for (final (name, status, body, headers, kind, retryable) in [
      ('Anmeldeseite im WLAN (200 mit HTML)', 200, '<html>Bitte anmelden</html>', _html, ApiFailureKind.notLykora, true),
      ('Weiterleitung auf eine Anmeldeseite', 302, '', {'location': 'http://portal'}, ApiFailureKind.notLykora, true),
      ('falsche Adresse (404 mit HTML)', 404, '<html>nicht gefunden</html>', _html, ApiFailureKind.notLykora, true),
      ('Proxy-Fehler 502 mit HTML', 502, '<html>Bad Gateway</html>', _html, ApiFailureKind.server, true),
      ('503 mit JSON', 503, '{"error":"unavailable"}', _json, ApiFailureKind.server, true),
      ('504 ohne Inhalt', 504, '', <String, String>{}, ApiFailureKind.server, true),
      ('401', 401, '{"error":"unauthorized"}', _json, ApiFailureKind.unauthorized, true),
      ('408', 408, '', <String, String>{}, ApiFailureKind.rateLimited, true),
      ('429', 429, '{"error":"rate_limit"}', _json, ApiFailureKind.rateLimited, true),
      ('404 vom Lykora-Server', 404, '{"error":"not_found","message":"Event nicht gefunden"}', _json, ApiFailureKind.notFound, false),
      ('400 Validierung', 400, '{"error":"invalid_request","message":"kaputt"}', _json, ApiFailureKind.rejected, false),
      ('409 Teamname vergeben', 409, '{"error":"team_name_taken","message":"Diesen Teamnamen gibt es schon"}', _json, ApiFailureKind.rejected, false),
    ]) {
      test(name, () async {
        final e = await failure(api((_) => http.Response(body, status, headers: headers)).get('/play/game'));
        expect(e.kind, kind);
        expect(e.status, status);
        expect(e.retryable, retryable);
        expect(e.message, isNotEmpty);
        expect(e.message, isNot(contains('Exception')), reason: 'kein Rohtext für die Oberfläche');
      });
    }

    test('Meldung des Servers kommt bei Ablehnung unverändert an', () async {
      final e = await failure(
        api((_) => http.Response('{"error":"team_name_taken","message":"Diesen Teamnamen gibt es schon"}', 409, headers: _json)).post('/join', {}),
      );
      expect(e.message, 'Diesen Teamnamen gibt es schon');
      expect(e.code, 'team_name_taken');
    });

    test('Netzfehler: offline', () async {
      final a = Api(_server, client: MockClient((_) async => throw const SocketException('weg')));
      final e = await failure(a.get('/play/game'));
      expect(e.kind, ApiFailureKind.offline);
      expect(e.offline, isTrue);
      expect(e.retryable, isTrue);
      expect(e.reachable, isFalse);
      expect(e.status, 0);
    });

    test('nur Antworten eines Lykora-Servers gelten als erreichbar', () async {
      Future<bool> reachable(int status, String body, Map<String, String> h) async =>
          (await failure(api((_) => http.Response(body, status, headers: h)).get('/x'))).reachable;
      expect(await reachable(400, '{"error":"x"}', _json), isTrue);
      expect(await reachable(401, '{}', _json), isTrue);
      expect(await reachable(503, '{}', _json), isFalse);
      expect(await reachable(200, '<html>', _html), isFalse);
    });

    test('Adresse ohne Schema oder Host: badAddress, ohne eine Anfrage zu senden', () async {
      var sent = 0;
      for (final server in ['example.org/lykora', '', 'ftp://example.org', 'https://']) {
        final a = Api(
          server,
          client: MockClient((_) async {
            sent++;
            return http.Response('{}', 200);
          }),
        );
        final e = await failure(a.get('/play/game'));
        expect(e.kind, ApiFailureKind.badAddress, reason: '"$server"');
        expect(e.offline, isFalse, reason: 'liegt nicht am Netz');
        expect(e.retryable, isFalse);
        expect(e.message, contains('Adresse'));
      }
      expect(sent, 0);
      expect(Api.isValidServer('https://example.org/lykora'), isTrue);
      expect(Api.isValidServer('http://192.168.1.5:3000'), isTrue);
      expect(Api.isValidServer('example.org'), isFalse);
    });

    test('leere Antwort und Liste', () async {
      expect(await api((_) => http.Response('', 200)).get('/x'), isEmpty);
      expect(await api((_) => http.Response('[1,2]', 200, headers: _json)).get('/x'), {
        'items': [1, 2],
      });
    });

    test('Token und Inhalt gehen mit', () async {
      http.Request? seen;
      await api((r) {
        seen = r;
        return http.Response('{}', 200);
      }).post('/play/sos', {'id': 'a'});
      expect(seen!.headers['authorization'], 'Bearer tok');
      expect(seen!.headers['content-type'], startsWith('application/json'));
      expect(jsonDecode(seen!.body), {'id': 'a'});
      expect(seen!.url.toString(), '$_server/api/play/sos');
    });

    test('Foto: Bytes, Typ und Kennung', () async {
      http.Request? seen;
      await api((r) {
        seen = r;
        return http.Response('{}', 201);
      }).upload('abc', 'image/jpeg', Uint8List.fromList([1, 2, 3]));
      expect(seen!.bodyBytes, [1, 2, 3]);
      expect(seen!.headers['content-type'], 'image/jpeg');
      expect(seen!.url.queryParameters['id'], 'abc');
    });
  });

  group('Zeitlimits', () {
    test('Server antwortet nicht in der Zeit: timeout', () async {
      final a = Api(
        _server,
        client: MockClient((_) async {
          await Future<void>.delayed(const Duration(milliseconds: 400));
          return http.Response('{}', 200);
        }),
        connectTimeout: const Duration(milliseconds: 100),
      );
      final e = await failure(a.get('/play/game'));
      expect(e.kind, ApiFailureKind.timeout);
      expect(e.offline, isTrue);
      expect(e.retryable, isTrue);
    });

    test('Abbruch: die Anfrage wird beim Zeitlimit abgebrochen', () async {
      Future<void>? trigger;
      final a = Api(
        _server,
        client: MockClient.streaming((req, _) async {
          trigger = (req as http.Abortable).abortTrigger;
          await Future<void>.delayed(const Duration(milliseconds: 400));
          return http.StreamedResponse(Stream.value(utf8.encode('{}')), 200);
        }),
        connectTimeout: const Duration(milliseconds: 100),
      );
      await failure(a.get('/play/game'));
      await trigger!.timeout(const Duration(seconds: 1));
    });

    test('Hochladen: das Limit wächst mit der Größe, die kleine Anfrage läuft ab', () async {
      Future<http.StreamedResponse> slow(http.BaseRequest _, http.ByteStream _) async {
        await Future<void>.delayed(const Duration(milliseconds: 300));
        return http.StreamedResponse(Stream.value(utf8.encode('{}')), 201);
      }

      final a = Api(_server, client: MockClient.streaming(slow), connectTimeout: const Duration(milliseconds: 100));
      // 100 KB bei mindestens 6 KB/s: gut 16 s Zeit
      expect(await a.upload('id', 'image/jpeg', Uint8List(100 * 1024)), isEmpty);
      final e = await failure(a.post('/play/sync', {'x': 1}));
      expect(e.kind, ApiFailureKind.timeout);
    });

    test('Antwort läuft lange, solange Daten kommen', () async {
      final a = Api(
        _server,
        client: MockClient.streaming((_, _) async {
          final body = Stream.periodic(const Duration(milliseconds: 40), (i) => utf8.encode(i == 0 ? '{"a":' : (i == 9 ? '1}' : ' ')));
          return http.StreamedResponse(body.take(10), 200, headers: _json);
        }),
        idleTimeout: const Duration(milliseconds: 150),
      );
      // 400 ms insgesamt, aber nie 150 ms Stillstand
      expect(await a.get('/play/game'), {'a': 1});
    });

    test('Antwort bleibt stehen: timeout', () async {
      final stalled = StreamController<List<int>>()..add(utf8.encode('{"a":'));
      addTearDown(stalled.close);
      final a = Api(
        _server,
        client: MockClient.streaming((_, _) async => http.StreamedResponse(stalled.stream, 200, headers: _json)),
        idleTimeout: const Duration(milliseconds: 150),
      );
      final e = await failure(a.get('/play/game'));
      expect(e.kind, ApiFailureKind.timeout);
    });

    test('Notruf: kürzeres Limit, aber nie länger als die eingestellte Verbindungszeit', () async {
      final a = Api(
        _server,
        client: MockClient((_) async {
          await Future<void>.delayed(const Duration(milliseconds: 400));
          return http.Response('{}', 200);
        }),
        connectTimeout: const Duration(milliseconds: 100),
      );
      final e = await failure(a.sos({'id': 'a'}));
      expect(e.kind, ApiFailureKind.timeout);
      expect(Api.sosTimeout, lessThan(const Duration(seconds: 15)));
    });
  });

  group('Medien laden', () {
    late Directory dir;
    setUp(() async => dir = await Directory.systemTemp.createTemp('lykora-api-'));

    test('große Datei darf länger dauern als das Verbindungslimit, solange Daten kommen', () async {
      final a = Api(
        _server,
        client: MockClient.streaming((_, _) async {
          final body = Stream.periodic(const Duration(milliseconds: 40), (i) => [i]).take(10);
          return http.StreamedResponse(body, 200, headers: {'content-type': 'audio/ogg'});
        }),
        connectTimeout: const Duration(milliseconds: 100),
        idleTimeout: const Duration(milliseconds: 150),
      );
      final file = File('${dir.path}/wind');
      expect(await a.download('media/wind.ogg', file), isTrue);
      expect(file.readAsBytesSync(), List.generate(10, (i) => i));
    });

    test('Strom bleibt stehen: false und keine halbe Datei', () async {
      final stalled = StreamController<List<int>>()..add([1, 2, 3]);
      addTearDown(stalled.close);
      final a = Api(
        _server,
        client: MockClient.streaming((_, _) async => http.StreamedResponse(stalled.stream, 200, headers: {'content-type': 'audio/ogg'})),
        idleTimeout: const Duration(milliseconds: 150),
      );
      final file = File('${dir.path}/wind');
      expect(await a.download('media/wind.ogg', file), isFalse);
      expect(file.existsSync(), isFalse);
      expect(File('${file.path}.part').existsSync(), isFalse);
    });

    test('HTML statt Klang: false', () async {
      final a = api((_) => http.Response('<html>', 200, headers: _html));
      expect(await a.download('media/wind.ogg', File('${dir.path}/wind')), isFalse);
      expect(File('${dir.path}/wind').existsSync(), isFalse);
    });
  });
}
