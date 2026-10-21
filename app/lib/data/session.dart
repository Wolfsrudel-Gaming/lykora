import 'dart:convert';
import 'dart:io';

import '../model/game.dart';

/// Eine Aktion des Teams oder der Spielleitung im lokalen Protokoll.
class LocalAction {
  LocalAction({required this.id, required this.type, required this.payload, required this.time, this.source = 'team', this.seq, this.synced = false});

  factory LocalAction.fromJson(Json j) => LocalAction(
    id: j['id'] as String,
    type: j['type'] as String,
    payload: (j['payload'] as Map).cast<String, dynamic>(),
    time: j['time'] as int,
    source: j['source'] as String? ?? 'team',
    seq: j['seq'] as int?,
    synced: j['synced'] as bool? ?? false,
  );

  final String id;
  final String type;
  final Json payload;

  /// ms seit Epoche; nach dem Abgleich die vom Server korrigierte Zeit
  int time;
  final String source;

  /// Laufende Nummer beim Server, sobald er die Aktion kennt
  int? seq;
  bool synced;

  Json toJson() => {'id': id, 'type': type, 'payload': payload, 'time': time, 'source': source, 'seq': seq, 'synced': synced};
}

class ChatMessage {
  ChatMessage({this.id, required this.direction, required this.kind, this.sender, required this.body, required this.at, this.clientId, this.pending = false});

  factory ChatMessage.fromJson(Json j) => ChatMessage(
    id: j['id'] as int?,
    direction: j['direction'] as String? ?? 'to_team',
    kind: j['kind'] as String? ?? 'chat',
    sender: j['sender'] as String?,
    body: j['body'] as String,
    at: DateTime.parse(j['at'] as String? ?? j['created_at'] as String),
    clientId: j['clientId'] as String?,
    pending: j['pending'] as bool? ?? false,
  );

  final int? id;

  /// to_team oder from_team
  final String direction;

  /// chat, hint, system, story oder predefined
  final String kind;
  final String? sender;
  final String body;
  final DateTime at;
  final String? clientId;
  bool pending;

  bool get incoming => direction == 'to_team';

  Json toJson() => {
    'id': id,
    'direction': direction,
    'kind': kind,
    'sender': sender,
    'body': body,
    'at': at.toIso8601String(),
    'clientId': clientId,
    'pending': pending,
  };
}

/// Alles, was die App über das laufende Spiel weiß. Wird nach jeder Änderung gespeichert.
class Session {
  Session({required this.server, required this.token, required this.eventId, required this.eventCode, required this.team});

  factory Session.fromJson(Json j) =>
      Session(
          server: j['server'] as String,
          token: j['token'] as String,
          eventId: j['eventId'] as String,
          eventCode: j['eventCode'] as String,
          team: (j['team'] as Map).cast<String, dynamic>(),
        )
        ..gameJson = (j['game'] as Map?)?.cast<String, dynamic>()
        ..event = (j['event'] as Map? ?? {}).cast<String, dynamic>()
        ..supervisorRequired = j['supervisorRequired'] as bool? ?? false
        ..actions = (j['actions'] as List? ?? const []).map((a) => LocalAction.fromJson((a as Map).cast())).toList()
        ..actionCursor = j['actionCursor'] as int? ?? 0
        ..messages = (j['messages'] as List? ?? const []).map((m) => ChatMessage.fromJson((m as Map).cast())).toList()
        ..messageCursor = j['messageCursor'] as int? ?? 0
        ..pendingPositions = (j['pendingPositions'] as List? ?? const []).cast<Map>().map((m) => m.cast<String, dynamic>()).toList()
        ..pendingSos = (j['pendingSos'] as List? ?? const []).cast<Map>().map((m) => m.cast<String, dynamic>()).toList()
        ..pendingUploads = (j['pendingUploads'] as List? ?? const []).cast<Map>().map((m) => m.cast<String, dynamic>()).toList()
        ..leaderboard = (j['leaderboard'] as List?)?.cast<Map>().map((m) => m.cast<String, dynamic>()).toList()
        ..serverState = (j['serverState'] as Map?)?.cast<String, dynamic>()
        ..recall = (j['recall'] as Map?)?.cast<String, dynamic>()
        ..clockOffsetMs = j['clockOffsetMs'] as int? ?? 0
        ..lastSyncAt = j['lastSyncAt'] == null ? null : DateTime.parse(j['lastSyncAt'] as String)
        ..lastHeartbeatAt = j['lastHeartbeatAt'] as int?
        ..introSeen = j['introSeen'] as bool? ?? false;

  final String server;
  final String token;
  final String eventId;
  final String eventCode;
  Json team;
  Json? gameJson;

  /// Status, startedAt, endedAt und Pausen des Events laut letztem Abgleich
  Json event = {};
  bool supervisorRequired = false;
  List<LocalAction> actions = [];
  int actionCursor = 0;
  List<ChatMessage> messages = [];
  int messageCursor = 0;
  List<Json> pendingPositions = [];
  List<Json> pendingSos = [];
  List<Json> pendingUploads = [];
  List<Json>? leaderboard;
  Json? serverState;
  Json? recall;

  /// Abweichung der Handy-Uhr zur Server-Uhr
  int clockOffsetMs = 0;

  DateTime? lastSyncAt;
  int? lastHeartbeatAt;

  bool introSeen = false;

  String get teamId => team['id'] as String;
  String get teamName => team['name'] as String? ?? '';
  String get deviceCode => team['deviceCode'] as String? ?? '';
  bool get supervisorPresent => team['supervisorPresent'] as bool? ?? false;
  List<String> get members => (team['members'] as List? ?? const []).map((m) => m is Map ? m['name'] as String : m as String).toList();
  String get eventStatus => event['status'] as String? ?? 'draft';

  Json toJson() => {
    'server': server,
    'token': token,
    'eventId': eventId,
    'eventCode': eventCode,
    'team': team,
    'game': gameJson,
    'event': event,
    'supervisorRequired': supervisorRequired,
    'actions': actions.map((a) => a.toJson()).toList(),
    'actionCursor': actionCursor,
    'messages': messages.map((m) => m.toJson()).toList(),
    'messageCursor': messageCursor,
    'pendingPositions': pendingPositions,
    'pendingSos': pendingSos,
    'pendingUploads': pendingUploads,
    'leaderboard': leaderboard,
    'serverState': serverState,
    'recall': recall,
    'clockOffsetMs': clockOffsetMs,
    'lastSyncAt': lastSyncAt?.toIso8601String(),
    'lastHeartbeatAt': lastHeartbeatAt,
    'introSeen': introSeen,
  };
}

/// Speichert Sitzung und Einstellungen als JSON-Dateien im App-Verzeichnis.
class SessionStore {
  SessionStore(this.dir);
  final Directory dir;

  File get _session => File('${dir.path}/session.json');
  File get _settings => File('${dir.path}/settings.json');
  Directory get mediaDir => Directory('${dir.path}/media');
  Directory get uploadsDir => Directory('${dir.path}/uploads');

  Future<Session?> load() async {
    if (!await _session.exists()) return null;
    try {
      return Session.fromJson(jsonDecode(await _session.readAsString()) as Json);
    } catch (_) {
      // Eine kaputte Datei darf die App nicht blockieren; Sicherung behalten.
      await _session.rename('${_session.path}.broken');
      return null;
    }
  }

  /// Schreibt erst in eine Hilfsdatei und benennt dann um, damit ein Absturz nichts zerstört.
  Future<void> save(Session s) => _write(_session, s.toJson());

  Future<void> clear() async {
    if (await _session.exists()) await _session.delete();
    if (await mediaDir.exists()) await mediaDir.delete(recursive: true);
    if (await uploadsDir.exists()) await uploadsDir.delete(recursive: true);
  }

  Future<Json> loadSettings() async {
    if (!await _settings.exists()) return {};
    try {
      return jsonDecode(await _settings.readAsString()) as Json;
    } catch (_) {
      return {};
    }
  }

  Future<void> saveSettings(Json settings) => _write(_settings, settings);

  Future<void> _write(File file, Json data) async {
    await dir.create(recursive: true);
    final tmp = File('${file.path}.tmp');
    await tmp.writeAsString(jsonEncode(data), flush: true);
    await tmp.rename(file.path);
  }
}
