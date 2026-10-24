// Anstupsen über die Team-Verbindung: Adresse, Pausen, Entprellen, Neuaufbau und der Abgleich danach.
// Statt eines echten Servers spricht ein nachgebauter WebSocket.

import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:lykora/data/api.dart';
import 'package:lykora/data/controller.dart';
import 'package:lykora/data/session.dart';
import 'package:lykora/services/live.dart';

import 'support.dart';

/// WebSocket ohne Netz: Der Test spielt den Server.
class FakeSocket extends StreamView<dynamic> implements WebSocket {
  FakeSocket._(this._in) : super(_in.stream);
  factory FakeSocket() => FakeSocket._(StreamController<dynamic>());

  final StreamController<dynamic> _in;
  bool closed = false;
  int? _code;

  void send(Map<String, dynamic> msg) => _in.add(jsonEncode(msg));

  /// Beliebiger Rahmen, auch kaputter
  void sendRaw(Object data) => _in.add(data);

  /// Server legt auf, z. B. mit 4401 bei falschem Token.
  void hangUp([int? code]) {
    _code = code;
    _in.close();
  }

  @override
  int? get closeCode => _code;

  @override
  Future<void> close([int? code, String? reason]) async {
    closed = true;
    _code ??= code;
    if (!_in.isClosed) unawaited(_in.close());
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

Future<void> wait([int ms = 60]) => Future<void>.delayed(Duration(milliseconds: ms));

void main() {
  test('Adresse der Team-Verbindung', () {
    expect(liveUri('https://riegel-troisdorf.de/lykora', 'tok').toString(), 'wss://riegel-troisdorf.de/lykora/api/play/live?access_token=tok');
    expect(liveUri('http://localhost:3000/lykora/', 'a b').toString(), 'ws://localhost:3000/lykora/api/play/live?access_token=a+b');
    expect(liveUri('https://example.org', 'tok').toString(), 'wss://example.org/api/play/live?access_token=tok');
  });

  test('Pause wächst von 2 s bis 60 s', () {
    expect([for (var i = 0; i <= 8; i++) liveBackoff(i).inSeconds], [2, 2, 4, 8, 16, 32, 60, 60, 60]);
  });

  test('Stupser werden entprellt, Hallo holt Verpasstes, Ping hält wach', () async {
    final sockets = <FakeSocket>[];
    var pokes = 0;
    final link = LiveLink(
      uri: liveUri('https://example.org/lykora', 'tok'),
      onPoke: () => pokes++,
      connect: (_) async => sockets.last,
      debounce: const Duration(milliseconds: 20),
    );
    sockets.add(FakeSocket());
    link.start();
    await wait(10);
    expect(link.connected, isTrue);
    expect(pokes, 0);
    sockets.last.send({'type': 'hello'});
    await wait();
    expect(pokes, 1, reason: 'nach dem Verbinden einmal abgleichen');
    for (final reason in ['message', 'cue', 'sos']) {
      sockets.last.send({'type': 'poke', 'reason': reason});
    }
    await wait();
    expect(pokes, 2, reason: 'drei Stupser kurz hintereinander, ein Abgleich');
    sockets.last
      ..send({'type': 'ping'})
      ..sendRaw('kein json')
      ..sendRaw([1, 2, 3])
      ..send({'type': 'poke', 'reason': 'status'});
    await wait();
    expect(pokes, 3);
    await link.stop();
    expect(sockets.last.closed, isTrue);
    expect(link.connected, isFalse);
  });

  test('baut abgerissene Verbindungen mit wachsender Pause neu auf', () async {
    final attempts = <DateTime>[];
    final sockets = <FakeSocket>[];
    var refuse = 2;
    final waits = <int>[];
    final link = LiveLink(
      uri: liveUri('https://example.org/lykora', 'tok'),
      onPoke: () {},
      connect: (_) async {
        attempts.add(DateTime.now());
        if (refuse-- > 0) throw const SocketException('kein Netz');
        return sockets.last;
      },
      backoff: (n) {
        waits.add(n);
        return Duration(milliseconds: 10 * n);
      },
    );
    sockets.add(FakeSocket());
    link.start();
    await wait(150);
    expect(attempts, hasLength(3));
    expect(waits, [1, 2], reason: 'zwei Fehlschläge, zwei wachsende Pausen');
    expect(link.connected, isTrue);
    sockets.last.send({'type': 'hello'});
    await wait(10);
    expect(link.failures, 0);

    // Server legt auf: neuer Versuch nach der kürzesten Pause.
    sockets.add(FakeSocket());
    sockets.first.hangUp();
    await wait(80);
    expect(attempts, hasLength(4));
    expect(link.connected, isTrue);

    // Falscher Token: lange Pause.
    sockets.last.hangUp(4401);
    await wait(10);
    expect(link.connected, isFalse);
    expect(waits.last, 6);
    await link.stop();
    expect(attempts, hasLength(4), reason: 'nach stop kein Versuch mehr');
  });

  test('ohne Lebenszeichen gilt die Verbindung als abgerissen', () async {
    var connects = 0;
    final link = LiveLink(
      uri: liveUri('https://example.org/lykora', 'tok'),
      onPoke: () {},
      connect: (_) async {
        connects++;
        return FakeSocket();
      },
      silence: const Duration(milliseconds: 30),
      backoff: (_) => const Duration(milliseconds: 5),
    );
    link.start();
    await wait(50);
    expect(connects, greaterThanOrEqualTo(2));
    await link.stop();
  });

  test('neu starten, während noch ein Versuch läuft, öffnet nur eine Verbindung', () async {
    final pending = Completer<WebSocket>();
    var connects = 0;
    final link = LiveLink(
      uri: liveUri('https://example.org/lykora', 'tok'),
      onPoke: () {},
      connect: (_) {
        connects++;
        return pending.future;
      },
    );
    link.start();
    await link.stop();
    link.start();
    final socket = FakeSocket();
    pending.complete(socket);
    await wait(10);
    expect(connects, 1);
    expect(link.connected, isTrue);
    expect(socket.closed, isFalse);
    await link.stop();
    expect(socket.closed, isTrue);
  });

  test('angestupst während eines Abgleichs: direkt danach noch einer, nach leave() keiner mehr', () async {
    final server = FakeServer();
    final socket = FakeSocket();
    final dir = await Directory.systemTemp.createTemp('lykora-live-');
    final c = GameController(
      store: SessionStore(dir),
      apiFactory: (s, t) => Api(s, token: t, client: server.client()),
      connectLive: (_) async => socket,
    );
    await c.join(server: 'https://example.org/lykora', code: 'K7M2QX', teamName: 'Füchse');
    c.startLoops();
    await wait(1300);
    expect(server.syncs, hasLength(1));

    server.holdSync = Completer<void>();
    socket.send({'type': 'poke', 'reason': 'message'});
    await wait(400);
    expect(c.syncing, isTrue);
    socket.send({'type': 'poke', 'reason': 'cue'});
    await wait(400);
    expect(server.syncs, hasLength(2), reason: 'der laufende Abgleich wird nicht verdoppelt');
    server.holdSync!.complete();
    server.holdSync = null;
    await wait(300);
    expect(server.syncs, hasLength(3), reason: 'der Stupser kam mitten im Abgleich; was er meldet, kann gefehlt haben');

    // Gleiches Spiel, aber das Team verlässt das Spiel, während der Abgleich hängt.
    server.holdSync = Completer<void>();
    socket.send({'type': 'poke', 'reason': 'message'});
    await wait(400);
    socket.send({'type': 'poke', 'reason': 'message'});
    await wait(400);
    expect(server.syncs, hasLength(4));
    await c.leave();
    server.holdSync!.complete();
    await wait(300);
    expect(server.syncs, hasLength(4));
    expect(socket.closed, isTrue);
  });

  test('Anstupsen löst sofort einen Abgleich aus, verlassen schließt die Verbindung', () async {
    final server = FakeServer();
    final sockets = <FakeSocket>[];
    final uris = <Uri>[];
    final dir = await Directory.systemTemp.createTemp('lykora-live-');
    final c = GameController(
      store: SessionStore(dir),
      apiFactory: (s, t) => Api(s, token: t, client: server.client()),
      connectLive: (uri) async {
        uris.add(uri);
        return sockets.last;
      },
    );
    await c.join(server: 'https://example.org/lykora', code: 'K7M2QX', teamName: 'Füchse');
    sockets.add(FakeSocket());
    c.startLoops();
    c.startLoops();
    // Erster Abgleich im Takt nach einer Sekunde, danach erst wieder nach 15 s.
    await wait(1300);
    expect(uris.single.toString(), 'wss://example.org/lykora/api/play/live?access_token=tok');
    expect(server.syncs, hasLength(1));

    server.pendingMessages.add({'kind': 'chat', 'body': 'Weiter so!'});
    sockets.single.send({'type': 'poke', 'reason': 'message'});
    await wait(600);
    expect(server.syncs, hasLength(2));
    expect(c.session!.messages.map((m) => m.body), contains('Weiter so!'));

    await c.leave();
    await wait(10);
    expect(sockets.single.closed, isTrue);
  });

  test('ohne Hintergrund-Takt keine Verbindung', () async {
    final server = FakeServer();
    var connects = 0;
    final dir = await Directory.systemTemp.createTemp('lykora-live-');
    final c = GameController(
      store: SessionStore(dir),
      apiFactory: (s, t) => Api(s, token: t, client: server.client()),
      backgroundLoops: false,
      connectLive: (_) async {
        connects++;
        return FakeSocket();
      },
    );
    await c.join(server: 'https://example.org/lykora', code: 'K7M2QX', teamName: 'Füchse');
    c.startLoops();
    await wait(30);
    expect(connects, 0);
  });
}
