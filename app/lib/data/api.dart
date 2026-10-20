import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:http/http.dart' as http;

import '../model/game.dart';

class ApiException implements Exception {
  ApiException(this.status, this.code, this.message);
  final int status;
  final String code;
  final String message;

  /// Kein Netz oder Server nicht erreichbar.
  bool get offline => status == 0;

  @override
  String toString() => message;
}

/// Zugriff auf die Spieler-Schnittstelle des Servers (server/src/routes/play.ts).
class Api {
  Api(this.server, {this.token, http.Client? client}) : _client = client ?? http.Client();

  /// Adresse inklusive Basispfad, z. B. https://riegel-troisdorf.de/lykora
  final String server;
  String? token;
  final http.Client _client;
  static const timeout = Duration(seconds: 12);

  Uri _uri(String path, [Map<String, String>? query]) {
    final base = server.endsWith('/') ? server.substring(0, server.length - 1) : server;
    return Uri.parse('$base/api$path').replace(queryParameters: query);
  }

  Map<String, String> get _headers => {
        'content-type': 'application/json',
        if (token != null) 'authorization': 'Bearer $token',
      };

  Future<Json> _send(Future<http.Response> Function() request) async {
    http.Response res;
    try {
      res = await request().timeout(timeout);
    } on TimeoutException {
      throw ApiException(0, 'offline', 'Server antwortet nicht');
    } catch (_) {
      throw ApiException(0, 'offline', 'Keine Verbindung zum Server');
    }
    final body = res.body.isEmpty ? <String, dynamic>{} : jsonDecode(utf8.decode(res.bodyBytes));
    if (res.statusCode >= 400) {
      final map = body is Map ? body : const {};
      throw ApiException(res.statusCode, map['error'] as String? ?? 'error', map['message'] as String? ?? 'Fehler ${res.statusCode}');
    }
    return body is Map<String, dynamic> ? body : {'items': body};
  }

  Future<Json> get(String path) => _send(() => _client.get(_uri(path), headers: _headers));
  Future<Json> post(String path, Object body) => _send(() => _client.post(_uri(path), headers: _headers, body: jsonEncode(body)));
  Future<Json> put(String path, Object body) => _send(() => _client.put(_uri(path), headers: _headers, body: jsonEncode(body)));

  Future<Json> join(Json body) => post('/join', body);
  Future<Json> game() => get('/play/game');
  Future<Json> sync(Json body) => post('/play/sync', body);
  Future<Json> sos(Json body) => post('/play/sos', body);
  Future<Json> message(Json body) => post('/play/messages', body);
  Future<Json> updateTeam(Json body) => put('/play/team', body);

  Future<Json> upload(String id, String contentType, Uint8List bytes) => _send(
        () => _client.post(
          _uri('/play/uploads', {'id': id}),
          headers: {'content-type': contentType, if (token != null) 'authorization': 'Bearer $token'},
          body: bytes,
        ),
      );
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
