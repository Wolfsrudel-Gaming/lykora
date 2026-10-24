import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:http/http.dart' as http;

import '../model/game.dart';

/// Woran eine Anfrage gescheitert ist. Davon hängt ab, ob ein späterer Versuch Sinn hat.
enum ApiFailureKind {
  /// Kein Netz oder Server nicht erreichbar
  offline,

  /// Keine Antwort in der erlaubten Zeit
  timeout,

  /// Fehler 5xx, z. B. 502/503/504 hinter dem Reverse-Proxy
  server,

  /// 401: Token ungültig oder abgelaufen
  unauthorized,

  /// 408/429: später noch einmal
  rateLimited,

  /// Antwort ist kein Lykora-JSON: Anmeldeseite im WLAN, falsche Adresse, Weiterleitung
  notLykora,

  /// Die Server-Adresse ist als Adresse unbrauchbar
  badAddress,

  /// 404 des Lykora-Servers: Event oder Team unbekannt
  notFound,

  /// Anderer 4xx: Der Server hat die Eingabe geprüft und abgelehnt
  rejected,
}

class ApiException implements Exception {
  ApiException(this.status, this.code, this.message, {ApiFailureKind? kind}) : kind = kind ?? (status == 0 ? ApiFailureKind.offline : ApiFailureKind.rejected);

  /// HTTP-Status, 0 ohne Antwort
  final int status;
  final String code;

  /// Satz für die Oberfläche
  final String message;
  final ApiFailureKind kind;

  /// Kein Netz oder keine Antwort in der Zeit.
  bool get offline => kind == ApiFailureKind.offline || kind == ApiFailureKind.timeout;

  /// Ein späterer Versuch kann gelingen. Nur eine Ablehnung des Servers (4xx) und eine unbrauchbare Adresse nicht.
  bool get retryable => switch (kind) {
    ApiFailureKind.badAddress || ApiFailureKind.notFound || ApiFailureKind.rejected => false,
    _ => true,
  };

  /// Ein Lykora-Server hat geantwortet, auch wenn er die Anfrage ablehnt.
  bool get reachable => switch (kind) {
    ApiFailureKind.unauthorized || ApiFailureKind.rateLimited || ApiFailureKind.notFound || ApiFailureKind.rejected => true,
    _ => false,
  };

  @override
  String toString() => message;
}

/// Kurzname, unter dem die Fehlerart in der Oberfläche auftaucht.
typedef ApiFailure = ApiException;

/// Zugriff auf die Spieler-Schnittstelle des Servers (server/src/routes/play.ts).
class Api {
  Api(this.server, {this.token, http.Client? client, this.connectTimeout = const Duration(seconds: 15), this.idleTimeout = const Duration(seconds: 20)})
    : _client = client ?? http.Client();

  /// Adresse inklusive Basispfad, z. B. https://riegel-troisdorf.de/lykora
  final String server;
  String? token;
  final http.Client _client;

  /// So lange darf es dauern, bis der Server überhaupt antwortet (Verbindung, Anfrage, erste Zeile).
  final Duration connectTimeout;

  /// So lange darf der Strom der Antwort oder einer Datei stillstehen. Es zählt der Fortschritt, nicht die Gesamtdauer.
  final Duration idleTimeout;

  /// Mindest-Datenrate in Byte/s, auf die das Zeitlimit beim Hochladen ausgelegt ist (etwa 50 kbit/s).
  static const uploadRate = 6 * 1024;

  /// Kürzeres Limit für den Notruf: scheitert er, steht er in der Warteschlange und der nächste Versuch kommt bald.
  static const sosTimeout = Duration(seconds: 10);

  /// Ist [server] eine Adresse, mit der sich Anfragen bauen lassen (http oder https mit Host)?
  static bool isValidServer(String server) {
    final uri = Uri.tryParse(server.trim());
    return uri != null && (uri.scheme == 'http' || uri.scheme == 'https') && uri.host.isNotEmpty;
  }

  Uri _uri(String path, [Map<String, String>? query]) {
    if (!isValidServer(server)) throw ApiException(0, 'bad_address', 'Die Server-Adresse ist ungültig.', kind: ApiFailureKind.badAddress);
    final trimmed = server.trim();
    final base = trimmed.endsWith('/') ? trimmed.substring(0, trimmed.length - 1) : trimmed;
    return Uri.parse('$base/api$path').replace(queryParameters: query);
  }

  Map<String, String> get _headers => {'content-type': 'application/json', if (token != null) 'authorization': 'Bearer $token'};

  /// Schickt eine Anfrage und liest die Antwort als JSON-Objekt.
  ///
  /// Das Limit bis zur Antwort wächst mit der Größe der Anfrage; die Antwort darf beliebig lange laufen,
  /// solange sie nicht stillsteht. Bei Zeitüberschreitung wird die Anfrage abgebrochen.
  Future<Json> _send(String method, String path, {Object? body, Map<String, String>? query, Map<String, String>? headers, Duration? connect}) async {
    final abort = Completer<void>();
    try {
      final request = http.AbortableRequest(method, _uri(path, query), abortTrigger: abort.future)..headers.addAll(headers ?? _headers);
      if (body is Uint8List) {
        request.bodyBytes = body;
      } else if (body != null) {
        request.body = jsonEncode(body);
      }
      final limit = (connect ?? connectTimeout) + Duration(milliseconds: 1000 * request.contentLength ~/ uploadRate);
      final res = await _client.send(request).timeout(limit);
      final bytes = await http.ByteStream(res.stream.timeout(idleTimeout)).toBytes();
      return _parse(res.statusCode, bytes);
    } on ApiException {
      rethrow;
    } on TimeoutException {
      if (!abort.isCompleted) abort.complete();
      throw ApiException(0, 'timeout', 'Der Server antwortet zu langsam.', kind: ApiFailureKind.timeout);
    } catch (_) {
      throw ApiException(0, 'offline', 'Kein Empfang. Eure Eingaben warten und werden nachgeschickt.');
    }
  }

  Json _parse(int status, List<int> bytes) {
    final text = utf8.decode(bytes, allowMalformed: true);
    Object? body;
    var json = false;
    if (text.trim().isNotEmpty) {
      try {
        body = jsonDecode(text);
        json = true;
      } on FormatException {
        // Anmeldeseite oder Fehlerseite des Proxys
      }
    }
    final map = body is Map ? body : const {};
    if (status >= 200 && status < 300) {
      // Eine Anmeldeseite im WLAN (Captive Portal) antwortet mit 200 und HTML.
      if (text.trim().isNotEmpty && !json) throw _notLykora(status);
      return body is Map<String, dynamic> ? body : {'items': ?body};
    }
    if (status >= 300 && status < 400) throw _notLykora(status);
    final code = map['error'] is String ? map['error'] as String : 'error';
    if (status == 401) throw ApiException(status, code, 'Dieses Handy ist nicht mehr angemeldet.', kind: ApiFailureKind.unauthorized);
    if (status == 408 || status == 429) throw ApiException(status, code, 'Zu viele Anfragen. Gleich noch einmal.', kind: ApiFailureKind.rateLimited);
    if (status >= 500) throw ApiException(status, code, 'Der Server hat gerade ein Problem (Fehler $status).', kind: ApiFailureKind.server);
    if (!json) throw _notLykora(status);
    throw ApiException(
      status,
      code,
      map['message'] is String ? map['message'] as String : 'Fehler $status',
      kind: status == 404 ? ApiFailureKind.notFound : ApiFailureKind.rejected,
    );
  }

  ApiException _notLykora(int status) => ApiException(
    status,
    'not_lykora',
    'Hier antwortet kein Lykora-Server. Prüft die Adresse und ob das WLAN eine Anmeldeseite hat.',
    kind: ApiFailureKind.notLykora,
  );

  Future<Json> get(String path) => _send('GET', path);
  Future<Json> post(String path, Object body) => _send('POST', path, body: body);
  Future<Json> put(String path, Object body) => _send('PUT', path, body: body);

  Future<Json> join(Json body) => post('/join', body);
  Future<Json> game() => get('/play/game');
  Future<Json> sync(Json body) => post('/play/sync', body);
  Future<Json> sos(Json body) => _send('POST', '/play/sos', body: body, connect: connectTimeout < sosTimeout ? connectTimeout : sosTimeout);
  Future<Json> message(Json body) => post('/play/messages', body);
  Future<Json> confirmSupervisor(String pin) => post('/play/supervisor', {'pin': pin});

  Future<Json> upload(String id, String contentType, Uint8List bytes) => _send(
    'POST',
    '/play/uploads',
    query: {'id': id},
    body: bytes,
    headers: {'content-type': contentType, if (token != null) 'authorization': 'Bearer $token'},
  );

  /// Adresse einer Mediendatei: [src] ist relativ zur Server-Adresse (media/…) oder eine URL.
  Uri mediaUri(String src) {
    if (src.startsWith('http://') || src.startsWith('https://')) return Uri.parse(src);
    final base = server.endsWith('/') ? server.substring(0, server.length - 1) : server;
    return Uri.parse('$base/${src.startsWith('/') ? src.substring(1) : src}');
  }

  /// Lädt eine Mediendatei nach [file]; false, wenn das nicht geklappt hat.
  Future<bool> download(String src, File file) async => await fetchFile(src, file) == FetchResult.saved;

  /// Lädt [src] nach [file] und sagt, wie es ausging: gespeichert, dem Server unbekannt (404) oder gescheitert.
  ///
  /// Erst in eine Hilfsdatei, damit ein Abbruch keine halbe Datei hinterlässt. Medien und Kacheln sind
  /// öffentlich; der Gerätetoken geht deshalb nicht mit, auch nicht an fremde Adressen.
  Future<FetchResult> fetchFile(String src, File file) async {
    final part = File('${file.path}.part');
    final abort = Completer<void>();
    try {
      final res = await _client.send(http.AbortableRequest('GET', mediaUri(src), abortTrigger: abort.future)).timeout(connectTimeout);
      // Eine Anmeldeseite im WLAN (Captive Portal) antwortet mit 200 und HTML; die wäre sonst als Klang gespeichert.
      final html = (res.headers['content-type'] ?? '').startsWith('text/html');
      if (res.statusCode != 200 || html) {
        await res.stream.drain<void>();
        // Eine HTML-Seite mit 404 kann ein Proxy sein; nur die Antwort des Servers gilt als „gibt es nicht“.
        return res.statusCode == 404 && !html ? FetchResult.notFound : FetchResult.failed;
      }
      final sink = part.openWrite();
      try {
        // Reißt der Strom ab, nicht ewig warten; eine große Datei darf lange laufen, solange Daten kommen.
        await sink.addStream(res.stream.timeout(idleTimeout));
      } finally {
        await sink.close();
      }
      await part.rename(file.path);
      return FetchResult.saved;
    } catch (_) {
      if (!abort.isCompleted) abort.complete();
      try {
        if (await part.exists()) await part.delete();
      } catch (_) {}
      return FetchResult.failed;
    }
  }
}

/// Ausgang von [Api.fetchFile].
enum FetchResult {
  /// Die Datei liegt jetzt auf dem Gerät.
  saved,

  /// Der Server kennt sie nicht (404).
  notFound,

  /// Kein Netz, Zeitüberschreitung, Fehler des Servers oder eine Anmeldeseite.
  failed,
}

/// Liest den Inhalt eines Einstiegs-QR: lykora://join?server=…&code=… oder ein reiner Event-Code.
({String? server, String code})? parseJoinCode(String raw) {
  final text = raw.trim();
  final uri = Uri.tryParse(text);
  if (uri != null && uri.scheme == 'lykora' && uri.host == 'join') {
    final code = uri.queryParameters['code'];
    if (code == null || code.isEmpty) return null;
    return (server: uri.queryParameters['server'], code: code.toUpperCase());
  }
  // Link der Form https://…/lykora/join/CODE
  if (uri != null && (uri.scheme == 'https' || uri.scheme == 'http')) {
    final i = uri.pathSegments.indexOf('join');
    if (i >= 0 && i + 1 < uri.pathSegments.length) {
      final base = uri.replace(pathSegments: uri.pathSegments.sublist(0, i), query: null, fragment: null).toString();
      return (server: base, code: uri.pathSegments[i + 1].toUpperCase());
    }
  }
  if (RegExp(r'^[A-Za-z0-9]{4,12}$').hasMatch(text)) return (server: null, code: text.toUpperCase());
  return null;
}
